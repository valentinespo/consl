import Link from "next/link";
import { ChevronRight, Warehouse, Truck } from "lucide-react";
import { getFacilitiesDetailed, getFinishedStock, getMovements, getProducts, getFacilities } from "@/lib/queries";
import { getFmt } from "@/lib/fmt-server";
import { qty } from "@/lib/format";
import { PageHeader, Card, SectionTitle, SkuAvatar } from "@/components/ui";
import { EmptyState } from "@/components/EmptyState";
import { NewFacilityButton } from "@/components/NewFacilityButton";
import { NewMovementPanel } from "@/components/MovementForm";
import { MovementsLedger } from "@/components/MovementsLedger";
import { facilityTypeLabel, isProductionSite } from "@/lib/facility-types";

export const dynamic = "force-dynamic";

export default async function FacilitiesPage() {
  const [facilities, stock, movements, products, facilityOptions, { money }] = await Promise.all([
    getFacilitiesDetailed(),
    getFinishedStock(),
    getMovements(),
    getProducts(),
    getFacilities(),
    getFmt(),
  ]);
  const todayISO = new Date().toISOString().slice(0, 10);
  const onHand = stock.rows.map((r) => ({ productId: r.productId, facilityId: r.facilityId, units: r.units }));

  // Finished stock per facility, for the card footers — the actual SKUs held, not just a count.
  type Held = { value: number; skus: { code: string; imageUrl: string | null; units: number; value: number }[] };
  const byFacility = new Map<string, Held>();
  for (const r of stock.rows) {
    const cur = byFacility.get(r.facilityId) ?? { value: 0, skus: [] };
    cur.value += r.value;
    cur.skus.push({ code: r.code, imageUrl: r.imageUrl, units: r.units, value: r.value });
    byFacility.set(r.facilityId, cur);
  }
  for (const h of byFacility.values()) h.skus.sort((a, b) => b.units - a.units);

  return (
    <>
      <PageHeader
        title="Facilities"
        subtitle="Everywhere your stock lives — co-packers, your own warehouses, and 3PLs you ship to."
      >
        <div className="flex flex-wrap items-center gap-2">
          {facilities.length > 0 && products.length > 0 && (
            <NewMovementPanel
              products={products.map((p) => ({ id: p.id, code: p.code, name: p.name }))}
              facilities={facilityOptions}
              onHand={onHand}
              todayISO={todayISO}
            />
          )}
          {facilities.length > 0 && <NewFacilityButton />}
        </div>
      </PageHeader>

      {facilities.length === 0 ? (
        <EmptyState
          icon={Warehouse}
          title="No facilities yet"
          body="Add the places your stock is made or stored. You'll pick a facility when logging purchases and production, and both raw materials and finished stock are tracked separately at each one."
        >
          <NewFacilityButton />
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {facilities.map((f) => {
            const held = byFacility.get(f.id);
            return (
              <Link key={f.id} href={`/facilities/${f.id}`} className="block">
                <Card className="flex h-full flex-col gap-3 transition-colors hover:border-accent-strong hover:bg-accent-soft/30">
                  <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                      <Warehouse size={18} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-ink">{f.code}</span>
                        <span className="rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-[10.5px] font-medium text-muted">
                          {facilityTypeLabel(f.type)}
                        </span>
                      </div>
                      <div className="truncate text-[12.5px] text-muted">{f.name}</div>
                      {/* Production counts only mean something where product is actually made. */}
                      {isProductionSite(f.type) && (
                        <div className="mt-0.5 text-[11px] text-muted">
                          {f._count.lots} lots · {f._count.purchases} purchases · {f._count.purchaseOrders} POs
                        </div>
                      )}
                    </div>
                    <ChevronRight size={16} className="shrink-0 text-muted" />
                  </div>

                  {/* Finished product currently sitting at this location, SKU by SKU. */}
                  <div className="mt-auto border-t border-line pt-2.5">
                    <div className="flex items-baseline justify-between">
                      <span className="text-[11px] uppercase tracking-wide text-muted">Finished stock here</span>
                      {held ? (
                        <span className="tabular text-[13px] font-semibold text-ink">{money(held.value)}</span>
                      ) : (
                        <span className="text-[12px] text-muted">None</span>
                      )}
                    </div>
                    {held && (
                      <div className="mt-1.5 space-y-1">
                        {held.skus.map((s) => (
                          <div key={s.code} className="flex items-center gap-2">
                            <SkuAvatar code={s.code} size={22} imageUrl={s.imageUrl} />
                            <span className="text-[12px] font-medium text-ink-soft">{s.code}</span>
                            <span className="tabular ml-auto text-[12px] text-muted">
                              {qty(s.units)} units · {money(s.value)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      {/* Movement ledger — what left which location, when, and where it went. */}
      <div className="mt-8">
        <SectionTitle>Stock movements</SectionTitle>
        <p className="-mt-2 mb-3 text-[12.5px] text-muted">
          Where finished product goes after it&apos;s made — between your locations, out to a sales channel, or to a customer.
        </p>

        {stock.shortfalls.length > 0 && (
          <div className="mb-3 rounded-lg border border-[#f0d3cb] bg-[#fdf2ef] px-3 py-2 text-[12px] text-negative">
            ⚠ {stock.shortfalls.length} movement{stock.shortfalls.length === 1 ? "" : "s"} shipped more units than that
            location had on record. Check the quantities below.
          </div>
        )}

        {movements.length === 0 ? (
          <EmptyState
            icon={Truck}
            title="No movements recorded yet"
            body="When a finished lot leaves the place it was made — to a 3PL, to Amazon, or to a customer — record it here so your inventory always shows where stock actually is."
          />
        ) : (
          <MovementsLedger movements={movements} />
        )}
      </div>
    </>
  );
}
