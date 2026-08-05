import type { RestockRow } from "@/lib/restock";

export const MONTH = 30.44;
export const MONTH_MS = MONTH * 86_400_000;
const DAY = 86_400_000;

export type ReorderStatus = "nosales" | "ok" | "reordered" | "channelLow" | "belowFloor" | "oos";
export type Win = 10 | 30 | 90;

export type ReorderResult = {
  monthly: number;
  win: Win;
  excl: number;
  override: boolean;
  onHandCover: number; // months of SELLABLE cover at the channel (FBA only — AWD excluded)
  awdCover: number; // months sitting in AWD — owned, but needs a replenishment to become sellable
  locCover: number; // months of cover at your own locations
  prodCover: number; // months of cover being made
  status: ReorderStatus;
  statusLabel: string;
  note?: string;
  recommendedQty: number; // units to order — a fixed run size (order-size months × monthly sales)
  ship: boolean; // move stock you own onto the channel
  expedite: boolean; // pull the incoming lot forward — only set when that actually shortens the outage
  order: boolean; // place a production run
  shipWithinDays: number; // how long you can still wait before shipping is too late (0 when moot)
  dryDays: number; // days the channel is empty even doing everything right from today
  belowFloor: boolean; // you own less than the floor, counting everything
};

/**
 * Turn one SKU's stock into a situation and the actions that fix it.
 *
 * The model is a timeline. Three moments matter, in months from today:
 *   - the channel runs out of what it can actually SELL (A = FBA incl. inbound; AWD is reserve
 *     stock that still needs a shipDays replenishment, so it rides with warehouse stock)
 *   - a truck loaded today lands at the channel (shipM)
 *   - the next production lot becomes sellable (Tc for a lot already placed, otherwise
 *     lead + shipping for a run you'd start today)
 *
 * Walking those in order yields the only honest outage number, as two independent gaps:
 *   gap1 — the channel is empty before your own truck can land. Warehouse stock can't shorten
 *          it (it's ON the truck); only a faster shipping route could.
 *   gap2 — everything you own runs out before the next lot lands. Only the lot's timing (or
 *          placing one at all) changes it.
 * dryDays = gap1 + gap2. That sum is exact: the two dark windows never overlap.
 *
 * STATUS names the situation, worst first — OOS (you will lose sales), Running low (the channel
 * needs a truck within days), Below floor (you own too little), Reordered (fine only because a
 * lot is coming), Healthy. ACTIONS are independent flags — ship / expedite / order — because a
 * row can need all three at once, and folding them into the status is how a stockout once hid
 * behind "ship the stock you have". A green status therefore *guarantees* there is nothing to do.
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

  // Cover in months, by where the stock is. AWD is Amazon's bulk reserve — those units must be
  // replenished into FBA (a shipDays move) before anyone can buy them, so they count with your
  // own locations as "owned, needs a truck", never as sellable channel stock. FBA's number keeps
  // its inbound units: they're already on their way to the sellable pool.
  const A = monthly > 0 ? r.fbaTotal / monthly : r.fbaTotal > 0 ? Infinity : 0;
  const W = monthly > 0 ? r.awdTotal / monthly : r.awdTotal > 0 ? Infinity : 0;
  const L = monthly > 0 ? r.atLocations / monthly : r.atLocations > 0 ? Infinity : 0;
  const P = monthly > 0 ? r.inProduction / monthly : r.inProduction > 0 ? Infinity : 0;
  const reserve = r.atLocations + r.awdTotal; // owned units a truck still has to move
  const hasPO = r.inProduction > 0;
  const total = A + W + L + P;

  const shipM = r.shipDays / MONTH;
  const shipBuffer = shipM * r.shipBufferX;
  const makeAndMove = r.leadMonths + shipM; // a run started today: made, then moved

  // When the soonest placed lot becomes sellable. An overdue lot counts as landing now.
  let Tc = 0;
  let overdue = false;
  if (hasPO && r.soonestPoISO) {
    const t = (new Date(r.soonestPoISO).getTime() + makeAndMove * MONTH_MS - nowMs) / MONTH_MS;
    overdue = t < 0;
    Tc = Math.max(0, t);
  }

  // No sales in the window is its own situation, not a healthy one: there's nothing to project
  // cover from, so a green "Healthy" here would be a false all-clear on a SKU that might have zero
  // stock. Every brand-new company sits here until its first sync brings sales in.
  let status: ReorderStatus = monthly > 0 ? "ok" : "nosales";
  let statusLabel = monthly > 0 ? "Healthy" : "No sales";
  let note: string | undefined;
  let recommendedQty = 0;
  let ship = false;
  let expedite = false;
  let order = false;
  let shipWithinDays = 0;
  let dryDays = 0;

  if (monthly > 0) {
    // Each gap is rounded to whole days on its own, and everything downstream — flags, status,
    // label — reads these numbers, so a sub-day sliver can never flag a row as an outage.
    const nextArrival = hasPO ? Tc : makeAndMove;
    // The truck only shortens the outage if it lands before the next lot does — the lot arrives
    // at the channel and ends the outage on its own. Without the cap, an overdue or nearly-landed
    // lot still charged the full wait-for-the-truck window and overstated the outage.
    const truckM = Math.min(shipM, nextArrival);
    const gap1Days = reserve > 0 ? Math.max(0, Math.round((truckM - A) * MONTH)) : 0;
    const endOwn = reserve > 0 ? Math.max(A, shipM) + L + W : A; // when everything you own is sold
    const gap2Days = Math.max(0, Math.round((nextArrival - endOwn) * MONTH));
    dryDays = gap1Days + gap2Days;
    // The slice of the outage that ends only when the lot lands — the part arriving earlier
    // would shrink. When the lot beats the truck, that's the whole of gap1; otherwise gap2.
    const arrivalGapDays = reserve > 0 && nextArrival <= shipM ? gap1Days : gap2Days;

    ship = reserve > 0 && (A <= shipBuffer || dryDays > 0);
    // Expediting only helps with the arrival-bound slice; if the darkness is all truck-speed,
    // the lot already lands in time and expediting it would be pure noise.
    expedite = hasPO && arrivalGapDays > 0;
    // A run helps if you own less than your floor — or you'll be dark with nothing on the way,
    // which stays true even when a mis-set floor sits below the lead time.
    order = total < r.minMonths || (!hasPO && arrivalGapDays > 0);
    if (ship && dryDays === 0) shipWithinDays = Math.max(0, Math.round((A - shipM) * MONTH));

    if (dryDays > 0) {
      status = "oos";
      statusLabel = `OOS for ${dryDays}d`;
      // Name the lever that is already priced in, so the number isn't mistaken for something the
      // obvious action would fix.
      note =
        arrivalGapDays === 0
          ? "before a shipment can land"
          : !hasPO
            ? "even if you order today"
            : r.atLocations > 0
              ? "even after shipping"
              : undefined;
    } else if (ship) {
      status = "channelLow";
      statusLabel = "Running low";
    } else if (A + W + L >= r.minMonths) {
      // Enough owned and already in your hands (AWD included), without leaning on anything still
      // being made.
      status = "ok";
      statusLabel = "Healthy";
    } else if (total >= r.minMonths) {
      // Clears the floor only once the incoming lot is counted — which is what Reordered means,
      // and the dryDays check above already proved that lot lands in time.
      status = "reordered";
      statusLabel = "Reordered";
    } else {
      status = "belowFloor";
      statusLabel = "Below floor";
    }

    if (order) {
      // A fixed run size — order-size months of sales, every time. Deliberately not netted off
      // what you already hold: runs are planned in whole batches, and a top-up sum hands you a
      // different odd number every time you look at it.
      const raw = Math.ceil(r.reorderToMonths * monthly);
      recommendedQty = r.batchSize > 0 && raw > 0 ? Math.ceil(raw / r.batchSize) * r.batchSize : raw;
    }
  }
  if (overdue) note = note ? `${note} · production overdue` : "production overdue";

  return {
    monthly,
    win,
    excl,
    override,
    onHandCover: A,
    awdCover: W,
    locCover: L,
    prodCover: P,
    status,
    statusLabel,
    note,
    recommendedQty,
    ship,
    expedite,
    order,
    shipWithinDays,
    dryDays,
    belowFloor: monthly > 0 && total < r.minMonths,
  };
}
