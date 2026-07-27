import type { RestockRow } from "@/lib/restock";

export const MONTH = 30.44;
export const MONTH_MS = MONTH * 86_400_000;
const DAY = 86_400_000;

export type ReorderStatus = "ok" | "reordered" | "reorder" | "oos" | "ship";
export type Win = 10 | 30 | 90;

export type ReorderResult = {
  monthly: number;
  win: Win;
  excl: number;
  override: boolean;
  onHandCover: number; // months of cover sitting at the sales channel
  locCover: number; // months of cover sitting at your own locations
  prodCover: number; // months of cover being made
  status: ReorderStatus;
  statusLabel: string;
  note?: string;
  recommendedQty: number;
  shipQty: number; // units worth shipping from your locations to top the channel back up
  expedite: boolean; // a lot is already coming and pulling it forward is what closes the gap
  dryDays: number; // days you'd be unable to sell, doing the best you can from today
  belowFloor: boolean;
};

/**
 * Turn one SKU's stock into a status, a shortfall and the actions that fix it.
 *
 * The model is a timeline, not a pile. Stock counts only from the moment it can actually reach the
 * sales channel: what's at the channel is sellable today, what's at your own warehouse is sellable
 * after `shipMonths`, and what's in production is sellable when the lot lands. Adding the three
 * together and comparing to a floor — which is what this used to do — answers "do I own enough?"
 * when the question that matters is "do I run out?". Those give different answers, and the gap
 * between them is where stockouts hid.
 *
 * So there is exactly one severe status. Out of stock means the channel genuinely hits zero, and
 * it is tested first, because everything else is about a comfort level and none of it may mask a
 * real outage. The rest of the ladder then reads: is the channel below its floor, and if so, what
 * closes it — moving stock you already own, a lot already coming, or a new order.
 */
export function computeReorder(r: RestockRow, globalWin: Win, nowMs: number): ReorderResult {
  const win: Win = r.windowDays === 10 || r.windowDays === 30 || r.windowDays === 90 ? r.windowDays : globalWin;
  const override = r.windowDays != null || (r.excludeDays ?? 0) > 0;
  const excl = Math.min(Math.max(0, r.excludeDays ?? 0), win - 1);

  const endMs = r.salesEnd ? Date.parse(r.salesEnd) : nowMs - 2 * DAY;
  const hasDaily = Object.keys(r.dailySales).length > 0;
  let units = 0;
  if (hasDaily) {
    for (let i = excl; i < win; i++) {
      const d = new Date(endMs - i * DAY).toISOString().slice(0, 10);
      units += r.dailySales[d] ?? 0;
    }
  } else {
    units = win === 10 ? r.units10d : win === 30 ? r.units30d : r.units90d;
  }
  const denomDays = hasDaily ? win - excl : win;
  const monthly = denomDays > 0 ? (units / denomDays) * MONTH : 0;

  // Cover in months, by where the stock is.
  const A = monthly > 0 ? r.onHand / monthly : r.onHand > 0 ? Infinity : 0; // at the channel
  const L = monthly > 0 ? r.atLocations / monthly : r.atLocations > 0 ? Infinity : 0; // at your locations
  const P = monthly > 0 ? r.inProduction / monthly : r.inProduction > 0 ? Infinity : 0; // being made
  const hasPO = r.inProduction > 0;
  const total = A + L + P;

  // When the soonest lot lands. Overdue lots are treated as landing now rather than in the past.
  let Tc = 0;
  let overdue = false;
  if (hasPO && r.soonestPoISO) {
    const t = (new Date(r.soonestPoISO).getTime() + r.leadMonths * MONTH_MS - nowMs) / MONTH_MS;
    overdue = t < 0;
    Tc = Math.max(0, t);
  }

  let status: ReorderStatus = "ok";
  let statusLabel = "Healthy";
  let note: string | undefined;
  let recommendedQty = 0;
  let shipQty = 0;
  let dryMonths = 0;

  // Units that would bring the sales channel back up to its target.
  const gapToTarget = Math.max(0, Math.ceil(r.reorderToMonths * monthly - r.onHand));

  if (monthly === 0) {
    status = "ok";
    statusLabel = "Healthy";
  } else {
    // --- Will the channel actually hit zero? ------------------------------------------------
    // Two separate windows can open. Before the shipment lands: if the channel runs out sooner
    // than stock can be trucked over, no amount of warehouse stock saves those days. Before the
    // lot lands: if the channel plus everything you'd ship still runs out first, you're dark even
    // having done everything right. Report the larger rather than the sum — one number, and it
    // never overstates the outage.
    const gapToShipment = r.atLocations > 0 ? Math.max(0, r.shipMonths - A) : 0;
    // With nothing on order, the soonest replacement is a run started today.
    const nextArrival = hasPO ? Tc : r.leadMonths;
    const gapToArrival = Math.max(0, nextArrival - (A + L));
    dryMonths = Math.max(gapToShipment, gapToArrival);

    if (dryMonths > 0) {
      status = "oos";
      statusLabel = `OOS for ${Math.round(dryMonths * MONTH)}d`;
      // Name the lever that has already been pulled, so the number isn't mistaken for something
      // the obvious action would fix. Which one depends on which gap is actually biting.
      note =
        gapToShipment > gapToArrival
          ? "before a shipment can land"
          : !hasPO
            ? "even if you order today"
            : r.atLocations > 0
              ? "even after shipping"
              : undefined;
    } else if (A >= r.minMonths) {
      status = "ok";
      statusLabel = "Healthy";
    } else if (r.atLocations > 0) {
      // Below floor with units you already own — moving them is always the first thing to do,
      // and producing more would leave stock sitting in two places.
      status = "ship";
      statusLabel = "Ship stock";
    } else if (hasPO && total >= r.minMonths) {
      status = "reordered";
      statusLabel = "Reordered";
    } else {
      status = "reorder";
      statusLabel = "Reorder";
    }
  }
  if (overdue) note = note ? `${note} · production overdue` : "production overdue";

  // --- What to do about it. Any combination of these can apply at once. ----------------------
  if (r.atLocations > 0 && (A < r.minMonths || dryMonths > 0)) {
    shipQty = Math.min(r.atLocations, gapToTarget);
  }
  const belowFloor = monthly > 0 && total < r.minMonths;
  if (belowFloor) {
    // Net off stock you already own — producing more of it would be double-ordering.
    const raw = Math.max(0, Math.ceil(r.reorderToMonths * monthly - r.onHand - r.inProduction - r.atLocations));
    recommendedQty = r.batchSize > 0 && raw > 0 ? Math.ceil(raw / r.batchSize) * r.batchSize : raw;
  }
  // Pulling a lot forward only helps if there is one and you'd otherwise be dark waiting for it.
  const expedite = hasPO && dryMonths > 0;

  return {
    monthly,
    win,
    excl,
    override,
    onHandCover: A,
    locCover: L,
    prodCover: P,
    status,
    statusLabel,
    note,
    recommendedQty,
    shipQty,
    expedite,
    dryDays: Math.round(dryMonths * MONTH),
    belowFloor,
  };
}
