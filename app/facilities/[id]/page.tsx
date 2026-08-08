import Link from "next/link";
import { notFound } from "next/navigation";
import { getFacilityDetail, getFacilitiesDetailed, getFinishedStock, getRawStockByFacility, getMaterialTypes, getSupplierOptions } from "@/lib/queries";
import { getFmt } from "@/lib/fmt-server";
import { inflectUnit } from "@/lib/format";
import { Package } from "@/components/icons";
import { PageHeader, Card, SkuAvatar } from "@/components/ui";
import { PrevNextNav, neighbours } from "@/components/PrevNextNav";
import { FacilityEditor } from "@/components/FacilityEditor";
import { Lock } from "@/components/icons";
import { CHANNEL_PROVIDER, PROVIDERS, getChannelStock } from "@/lib/integrations";
import { DeleteEntity } from "@/components/DeleteEntity";
import { deleteFacility } from "@/app/facilities/actions";
import { facilityTypeLabel } from "@/lib/facility-types";
import { requireView } from "@/lib/membership";

export const dynamic = "force-dynamic";

export default async function FacilityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireView("facilities");
  const { id } = await params;
  const [detail, facilities, stock, rawByFacilityCode, materials, suppliers, { money, qty }] = await Promise.all([
    getFacilityDetail(id),
    getFacilitiesDetailed(),
    getFinishedStock(),
    getRawStockByFacility(),
    getMaterialTypes(),
    getSupplierOptions(),
    getFmt(),
  ]);
  const channelStock = await getChannelStock();
  if (!detail) notFound();
  const { facility, usedBy } = detail;
  const nav = neighbours(facilities, id, "/facilities");
  // A channel facility holds what its platform reports (FBA/AWD snapshots, valued at cost);
  // physical facilities hold what the finished-goods engine says is on hand.
  const here = facility.channel ? channelStock.rows.filter((r) => r.facilityId === id) : stock.rows.filter((r) => r.facilityId === id);
  const hereValue = here.reduce((s, r) => s + r.value, 0);
  const rawHere = rawByFacilityCode.get(facility.code) ?? [];
  const rawValue = rawHere.reduce((s, r) => s + r.value, 0);
  const unitLabelOf = (code: string) => materials.find((m) => m.code === code)?.unitLabel ?? "unit";

  return (
    <>
      <Link href="/facilities" className="mb-3 inline-block text-[12.5px] font-medium text-muted hover:text-ink-soft">
        ← Facilities
      </Link>
      <PageHeader title={facility.name} subtitle={`${facilityTypeLabel(facility.type)} · ${facility.code}`}>
        <PrevNextNav {...nav} />
      </PageHeader>

      {facility.locked ? (
        <Card className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Lock size={17} />
          </span>
          <div className="text-[13px] leading-relaxed text-ink-soft">
            <div className="font-semibold text-ink">Managed by your {channelProviderLabel(facility.channel)} connection</div>
            This facility mirrors a connected sales channel, so its details can&apos;t be edited or deleted here — it lives and
            dies with the connection in{" "}
            <Link href="/settings/integrations" className="font-medium text-accent hover:underline">
              Settings → Integrations
            </Link>
            .
          </div>
        </Card>
      ) : (
        <FacilityEditor
          facility={{
            id: facility.id,
            code: facility.code,
            name: facility.name,
            type: facility.type,
            legalName: facility.legalName,
            address: facility.address,
            notes: facility.notes,
            supplierId: facility.supplierProfile?.id ?? null,
          }}
          suppliers={suppliers}
        />
      )}

      <div className="mt-5">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[12px] font-medium uppercase tracking-wide text-muted">Finished goods on hand</div>
            {here.length > 0 && <div className="tabular text-[13px] font-semibold text-ink">{money(hereValue)}</div>}
          </div>
          {here.length === 0 ? (
            <p className="text-[12.5px] text-muted">
              {facility.channel
                ? "Nothing reported by the platform yet — stock appears here with each sync."
                : "No finished stock recorded here. Units land here when a lot produced at this facility is marked finished, and leave when you record a movement."}
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {here.map((r) => (
                <div key={r.productId} className="flex items-center gap-2.5 rounded-lg border border-border bg-surface-2/50 px-3 py-2">
                  <SkuAvatar code={r.code} size={28} imageUrl={r.imageUrl} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-semibold text-ink">{r.code}</div>
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
        </Card>
      </div>

      {!facility.channel && (
      <div className="mt-5">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[12px] font-medium uppercase tracking-wide text-muted">Raw materials on hand</div>
            {rawHere.length > 0 && <div className="tabular text-[13px] font-semibold text-ink">{money(rawValue)}</div>}
          </div>
          {rawHere.length === 0 ? (
            <p className="text-[12.5px] text-muted">
              No raw-material stock recorded here. Raw materials arrive via purchases booked to this facility, and leave when
              consumed by production or moved.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {rawHere.map((r, i) => (
                <div key={`${r.code}-${r.sku ?? ""}-${i}`} className="flex items-center gap-2.5 rounded-lg border border-border bg-surface-2/50 px-3 py-2">
                  {r.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.imageUrl} alt={r.name} className="h-7 w-7 rounded-md border border-border object-cover" />
                  ) : (
                    <span className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-surface text-muted">
                      <Package size={14} />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-semibold text-ink">{r.name}</div>
                    {r.sku && <div className="truncate text-[11px] text-muted">for {r.sku}</div>}
                  </div>
                  <div className="text-right">
                    <div className="tabular text-[13px] font-medium text-ink">
                      {qty(r.units)} <span className="text-[10.5px] font-normal text-muted">{inflectUnit(unitLabelOf(r.code), r.units)}</span>
                    </div>
                    <div className="tabular text-[11px] text-muted">{money(r.value)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
      )}

      {!facility.locked && (
        <DeleteEntity
          kind="facility"
          name={facility.name}
          usedBy={usedBy}
          onDelete={deleteFacility.bind(null, facility.id)}
          redirectTo="/facilities"
          resource="facilities"
        />
      )}
    </>
  );
}

/** "AMAZON_FBA" → "Amazon" (falls back to the raw channel name). */
function channelProviderLabel(channel: string | null): string {
  if (!channel) return "integration";
  const p = CHANNEL_PROVIDER[channel];
  return p ? PROVIDERS[p].label : channel;
}
