import { NextResponse } from "next/server";
import { prismaBase } from "@/lib/prisma-base";
import { runWithOrg } from "@/lib/tenant";
import { getHandoffPlan } from "@/lib/handoff";
import { computeFinishedGoods } from "@/lib/queries";
import { getRestock } from "@/lib/restock";

/** Maintenance-only (ALLOW_DEV_TASKS=1): the virtual-handoff plan + resulting totals per org —
 *  the Phase 5 gate (a fully-netted org must show an empty plan and unchanged buckets). */
export async function GET() {
  if (process.env.ALLOW_DEV_TASKS !== "1") return new Response("Not found", { status: 404 });
  const orgs = await prismaBase.organization.findMany({ where: { deactivatedAt: null }, select: { id: true, name: true } });
  const out = [];
  for (const o of orgs) {
    out.push(
      await runWithOrg(o.id, async () => {
        const [plan, fg, restock] = [await getHandoffPlan(), await computeFinishedGoods(), await getRestock()];
        return {
          org: o.name,
          plan: {
            totalUnits: plan.totalUnits,
            bySku: [...plan.bySku.entries()].map(([sku, v]) => ({ sku, qty: v.qty, shipments: v.shipmentIds.length })),
            shipmentSyncStatus: plan.shipmentSyncStatus,
          },
          pools: { units: fg.pools.reduce((s, p) => s + p.units, 0), value: +fg.pools.reduce((s, p) => s + p.value, 0).toFixed(2) },
          shortfalls: fg.shortfalls.length,
          totals: Object.fromEntries(
            Object.entries(restock.totals).map(([k, v]) => [k, typeof v === "number" ? +v.toFixed(2) : v]),
          ),
          awaitingHandoff: restock.rows.filter((r) => r.awaitingHandoff > 0).map((r) => ({ code: r.code, qty: r.awaitingHandoff, inProduction: r.inProduction })),
        };
      }),
    );
  }
  return NextResponse.json(out);
}
