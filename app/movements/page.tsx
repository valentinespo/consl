import { Truck } from "lucide-react";
import { getMovements, getFinishedStock, getProducts, getFacilities } from "@/lib/queries";
import { getFmt } from "@/lib/fmt-server";
import { PageHeader, Card, SkuAvatar, FacilityTag } from "@/components/ui";
import { EmptyState } from "@/components/EmptyState";
import { NewMovementPanel } from "@/components/MovementForm";
import { DeleteMovement } from "@/components/DeleteMovement";
import { destinationLabel } from "@/lib/destinations";
import { qty, date as fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function MovementsPage() {
  const [movements, stock, products, facilities, { money }] = await Promise.all([
    getMovements(),
    getFinishedStock(),
    getProducts(),
    getFacilities(),
    getFmt(),
  ]);
  const todayISO = new Date().toISOString().slice(0, 10);
  const onHand = stock.rows.map((r) => ({ productId: r.productId, facilityId: r.facilityId, units: r.units }));
  const totalValue = stock.rows.reduce((s, r) => s + r.value, 0);

  return (
    <>
      <PageHeader
        title="Stock movements"
        subtitle="Where your finished product goes after it's made — between your locations, out to a sales channel, or to a customer."
      >
        {facilities.length > 0 && products.length > 0 && (
          <NewMovementPanel
            products={products.map((p) => ({ id: p.id, code: p.code, name: p.name }))}
            facilities={facilities}
            onHand={onHand}
            todayISO={todayISO}
          />
        )}
      </PageHeader>

      {/* On hand at your own locations */}
      <Card className="mb-6">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[12px] font-medium uppercase tracking-wide text-muted">Finished goods at your locations</div>
          <div className="tabular text-[13px] font-semibold text-ink">{money(totalValue)}</div>
        </div>
        {stock.rows.length === 0 ? (
          <p className="text-[12.5px] text-muted">
            Nothing on hand at your own locations — finished stock is either still in production or already shipped out.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {stock.rows.map((r) => (
              <div key={`${r.productId}-${r.facilityId}`} className="flex items-center gap-2.5 rounded-lg border border-border bg-surface-2/50 px-3 py-2">
                <SkuAvatar code={r.code} size={28} imageUrl={r.imageUrl} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[12.5px] font-semibold text-ink">{r.code}</span>
                    <FacilityTag code={r.facilityCode} />
                  </div>
                  <div className="truncate text-[11px] text-muted">{r.name}</div>
                </div>
                <div className="text-right">
                  <div className="tabular text-[13px] font-medium text-ink">{qty(r.units)}</div>
                  <div className="tabular text-[11px] text-muted">{money(r.value)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
        {stock.shortfalls.length > 0 && (
          <div className="mt-3 rounded-lg border border-[#f0d3cb] bg-[#fdf2ef] px-3 py-2 text-[12px] text-negative">
            ⚠ {stock.shortfalls.length} movement{stock.shortfalls.length === 1 ? "" : "s"} shipped more units than that
            location had on record. Check the quantities below.
          </div>
        )}
      </Card>

      {movements.length === 0 ? (
        <EmptyState
          icon={Truck}
          title="No movements recorded yet"
          body="When a finished lot leaves the place it was made — to a 3PL, to Amazon, or to a customer — record it here so your inventory always shows where stock actually is."
        />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface">
          <table className="w-full min-w-[720px] text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="px-5 py-2.5 font-medium">Date</th>
                <th className="px-3 py-2.5 font-medium">Product</th>
                <th className="px-3 py-2.5 text-right font-medium">Units</th>
                <th className="px-3 py-2.5 font-medium">From</th>
                <th className="px-3 py-2.5 font-medium">To</th>
                <th className="px-3 py-2.5 font-medium">Note</th>
                <th className="px-5 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id} className="border-b border-line last:border-0">
                  <td className="whitespace-nowrap px-5 py-2.5 text-muted">{fmtDate(m.date)}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <SkuAvatar code={m.code} size={24} imageUrl={m.imageUrl} />
                      <span className="font-medium text-ink">{m.code}</span>
                    </div>
                  </td>
                  <td className="tabular px-3 py-2.5 text-right font-medium">{qty(m.quantity)}</td>
                  <td className="px-3 py-2.5">
                    <FacilityTag code={m.fromCode} />
                  </td>
                  <td className="px-3 py-2.5">
                    {m.toCode ? <FacilityTag code={m.toCode} /> : <span className="text-ink-soft">{destinationLabel(m.toDestination)}</span>}
                  </td>
                  <td className="max-w-[220px] truncate px-3 py-2.5 text-[12px] text-muted">{m.notes ?? "—"}</td>
                  <td className="px-5 py-2.5 text-right">
                    <DeleteMovement id={m.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
