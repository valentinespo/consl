import "server-only";
import { prisma } from "@/lib/prisma";
import { getInventory } from "@/lib/queries";
import { computeReorder } from "@/lib/reorder";
import type { RestockRow } from "@/lib/restock";

export type Alert = {
  key: string; // stable identity, e.g. "reorder:LDX"
  kind: "reorder" | "expedite" | "material" | "ship";
  title: string;
  detail: string;
  severity: "critical" | "warn";
};

const num = (x: number) => Math.round(x).toLocaleString("en-US");

/** Active dashboard notifications: SKUs needing a PO / expedite + materials below their threshold.
 *  Dismissed alerts are hidden; dismissals whose condition has resolved are pruned (so they recur fresh). */
export async function getAlerts(rows: RestockRow[]): Promise<Alert[]> {
  const now = Date.now();
  const alerts: Alert[] = [];

  for (const r of rows) {
    const win = r.windowDays === 10 || r.windowDays === 30 || r.windowDays === 90 ? r.windowDays : 90;
    const c = computeReorder(r, win, now);
    if (c.status === "ship") {
      // Already made and already yours — it just needs moving, so this beats a reorder alert.
      alerts.push({
        key: `ship:${r.code}`,
        kind: "ship",
        title: `${r.name} — ship stock you already have`,
        detail: `${num(c.shipQty)} units at ${r.atLocationsBy.map((x) => x.code).join(" / ") || "your locations"}`,
        severity: "warn",
      });
    } else if (c.belowFloor) {
      alerts.push({
        key: `reorder:${r.code}`,
        kind: "reorder",
        title: `${r.name} needs a PO`,
        detail: c.recommendedQty > 0 ? `${num(c.recommendedQty)} units recommended` : "below the floor",
        severity: "warn",
      });
    } else if (c.status === "oos") {
      alerts.push({
        key: `expedite:${r.code}`,
        kind: "expedite",
        title: `${r.name} — expedite incoming lot`,
        detail: c.statusLabel,
        severity: "warn",
      });
    }
  }

  // Material low-stock (per-material threshold set in Catalog).
  const [inv, materials] = await Promise.all([
    getInventory(),
    prisma.materialType.findMany({ where: { lowStockThreshold: { not: null } } }),
  ]);
  const availByMat = new Map<string, number>();
  for (const p of inv.pools) availByMat.set(p.materialCode, (availByMat.get(p.materialCode) ?? 0) + p.quantityRemaining);
  for (const m of materials) {
    const avail = availByMat.get(m.code) ?? 0;
    if (m.lowStockThreshold != null && avail < m.lowStockThreshold) {
      alerts.push({
        key: `material:${m.code}`,
        kind: "material",
        title: `${m.name} low in stock`,
        detail: `${num(avail)} ${m.unitLabel} left · below ${num(m.lowStockThreshold)}`,
        severity: "critical",
      });
    }
  }

  // Auto-clear resolved dismissals, then hide the ones still dismissed.
  const dismissed = await prisma.dismissedNotification.findMany();
  const activeKeys = new Set(alerts.map((a) => a.key));
  const stale = dismissed.filter((d) => !activeKeys.has(d.key)).map((d) => d.key);
  if (stale.length) await prisma.dismissedNotification.deleteMany({ where: { key: { in: stale } } });
  const hidden = new Set(dismissed.map((d) => d.key));
  return alerts.filter((a) => !hidden.has(a.key));
}
