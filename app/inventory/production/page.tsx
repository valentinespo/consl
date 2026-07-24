import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { qty, date } from "@/lib/format";
import { getFmt } from "@/lib/fmt-server";
import { PageHeader, StatCard, SkuAvatar, FacilityTag } from "@/components/ui";
import { InventoryNav } from "@/components/InventoryNav";

export const dynamic = "force-dynamic";

export default async function ProductionPage() {
  const lots = await prisma.lot.findMany({
    where: { status: "IN_PRODUCTION" },
    include: { facility: true, lines: { include: { product: true } } },
    orderBy: [{ poDate: "desc" }, { createdAt: "desc" }],
  });
  const rows = lots.map((l) => ({
    id: l.id,
    nr: l.lotNr,
    poDate: l.poDate,
    facility: l.facility.code,
    lines: l.lines,
    units: l.lines.reduce((s, x) => s + x.units, 0),
    value: l.lines.reduce((s, x) => s + x.units * x.cogPerUnit, 0),
  }));
  const totalUnits = rows.reduce((s, r) => s + r.units, 0);
  const totalValue = rows.reduce((s, r) => s + r.value, 0);
  const { money } = await getFmt();

  return (
    <>
      <PageHeader title="Inventory" subtitle="Lots currently in production — not yet shipped to Amazon." />
      <InventoryNav />

      <div className="mb-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <StatCard label="Open lots" value={String(rows.length)} />
        <StatCard label="Units in production" value={qty(totalUnits)} />
        <StatCard label="Value in production" value={money(totalValue)} accent />
      </div>

      <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface">
        <table className="w-full min-w-[640px] text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted">
              <th className="px-4 py-2.5 font-medium">Lot</th>
              <th className="px-3 py-2.5 font-medium">Facility</th>
              <th className="px-3 py-2.5 font-medium">SKUs</th>
              <th className="px-3 py-2.5 text-right font-medium">Units</th>
              <th className="px-4 py-2.5 text-right font-medium">COG value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className={i < rows.length - 1 ? "border-b border-line" : ""}>
                <td className="px-4 py-3">
                  <Link href={`/lots/${r.id}`} className="font-medium text-ink hover:underline">
                    #{r.nr}
                  </Link>
                  <div className="text-[11px] text-muted">{r.poDate ? date(r.poDate.toISOString().slice(0, 10)) : "—"}</div>
                </td>
                <td className="px-3 py-3">
                  <FacilityTag code={r.facility} />
                </td>
                <td className="px-3 py-3">
                  <div className="flex flex-wrap items-center gap-2.5">
                    {r.lines.map((ln) => (
                      <span key={ln.id} className="inline-flex items-center gap-1.5">
                        <SkuAvatar code={ln.product.code} imageUrl={ln.product.imageUrl} size={22} />
                        <span className="text-[11px] tabular text-muted">{qty(ln.units)}</span>
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-3 text-right font-medium tabular">{qty(r.units)}</td>
                <td className="px-4 py-3 text-right font-medium tabular">{money(r.value)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-[13px] text-muted">
                  Nothing in production right now.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
