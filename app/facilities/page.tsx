import Link from "next/link";
import { ChevronRight, Warehouse } from "lucide-react";
import { getFacilitiesDetailed } from "@/lib/queries";
import { PageHeader, Card } from "@/components/ui";
import { EmptyState } from "@/components/EmptyState";
import { NewFacilityButton } from "@/components/NewFacilityButton";
import { facilityTypeLabel } from "@/lib/facility-types";

export const dynamic = "force-dynamic";

export default async function FacilitiesPage() {
  const facilities = await getFacilitiesDetailed();

  return (
    <>
      <PageHeader
        title="Facilities"
        subtitle="Everywhere your stock lives — co-packers, your own warehouses, and 3PLs you ship to."
      >
        {facilities.length > 0 && <NewFacilityButton />}
      </PageHeader>

      {facilities.length === 0 ? (
        <EmptyState
          icon={Warehouse}
          title="No facilities yet"
          body="Add the places your stock is made or stored. You'll pick a facility when logging purchases and production, and raw-material stock is tracked separately at each one."
        >
          <NewFacilityButton />
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {facilities.map((f) => (
            <Link key={f.id} href={`/facilities/${f.id}`} className="block">
              <Card className="flex items-center gap-3 transition-colors hover:border-accent-strong hover:bg-accent-soft/30">
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
                  <div className="mt-0.5 text-[11px] text-muted">
                    {f._count.lots} lots · {f._count.purchases} purchases · {f._count.purchaseOrders} POs
                  </div>
                </div>
                <ChevronRight size={16} className="shrink-0 text-muted" />
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
