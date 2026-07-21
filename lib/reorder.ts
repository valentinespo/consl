import type { RestockRow } from "@/lib/restock";

export const MONTH = 30.44;
export const MONTH_MS = MONTH * 86_400_000;
const DAY = 86_400_000;

export type ReorderStatus = "ok" | "reordered" | "reorder" | "oos";
export type Win = 10 | 30 | 90;

export type ReorderResult = {
  monthly: number;
  win: Win;
  excl: number;
  override: boolean;
  onHandCover: number;
  prodCover: number;
  status: ReorderStatus;
  statusLabel: string;
  note?: string;
  recommendedQty: number;
  belowFloor: boolean;
};

/** Pure reorder computation shared by the inventory dashboard and the alert engine. */
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
  const A = monthly > 0 ? r.onHand / monthly : r.onHand > 0 ? Infinity : 0;
  const P = monthly > 0 ? r.inProduction / monthly : r.inProduction > 0 ? Infinity : 0;
  const hasPO = r.inProduction > 0;
  const total = A + P;

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

  if (monthly === 0) {
    status = "ok";
    statusLabel = "Healthy";
  } else if (hasPO) {
    if (A < Tc) {
      status = "oos";
      statusLabel = `OOS for ${Math.round((Tc - A) * MONTH)}d`;
    } else if (total >= r.minMonths) {
      status = "reordered";
      statusLabel = "Reordered";
    } else {
      status = "reorder";
      statusLabel = "Reorder";
      if (total < r.leadMonths) note = `off by ${Math.round((r.leadMonths - total) * MONTH)}d`;
    }
  } else {
    if (A >= r.minMonths) {
      status = "ok";
      statusLabel = "Healthy";
    } else {
      status = "reorder";
      statusLabel = "Reorder";
      if (A < r.leadMonths) note = `off by ${Math.round((r.leadMonths - A) * MONTH)}d`;
    }
  }
  if (overdue) note = note ? `${note} · production overdue` : "production overdue";

  const belowFloor = monthly > 0 && total < r.minMonths;
  if (belowFloor) {
    const raw = Math.max(0, Math.ceil(r.reorderToMonths * monthly - r.onHand - r.inProduction));
    recommendedQty = r.batchSize > 0 && raw > 0 ? Math.ceil(raw / r.batchSize) * r.batchSize : raw;
  }
  return { monthly, win, excl, override, onHandCover: A, prodCover: P, status, statusLabel, note, recommendedQty, belowFloor };
}
