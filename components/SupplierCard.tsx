import Link from "next/link";
import { Mail, Phone, MapPin, ChevronRight } from "lucide-react";
import { Card, FacilityTag } from "@/components/ui";
import { getFmt } from "@/lib/fmt-server";
import { initials } from "@/lib/initials";

export type SupplierRow = {
  id: string;
  name: string;
  photoUrl: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  facilityId: string | null;
  facilityCode: string | null;
  purchases: number;
  transactions: number;
  totalSpend: number;
};

/** Supplier tile — links into the supplier's own page, where editing lives. */
export async function SupplierCard({ supplier: s }: { supplier: SupplierRow }) {
  const { money } = await getFmt();
  return (
    <Link href={`/suppliers/${s.id}`} className="block">
      <Card className="flex flex-col gap-3 transition-colors hover:border-accent-strong hover:bg-accent-soft/30">
        <div className="flex items-center gap-3">
          {s.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={s.photoUrl} alt={s.name} className="h-12 w-12 shrink-0 rounded-full border border-border object-cover" />
          ) : (
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent text-[15px] font-semibold text-ink">
              {initials(s.name)}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-semibold text-ink">{s.name}</span>
              {s.facilityCode && <FacilityTag code={s.facilityCode} />}
            </div>
            <div className="mt-0.5 space-y-0.5 text-[12px] text-muted">
              {s.email && (
                <div className="flex items-center gap-1.5 truncate">
                  <Mail size={11} /> {s.email}
                </div>
              )}
              {s.phone && (
                <div className="flex items-center gap-1.5">
                  <Phone size={11} /> {s.phone}
                </div>
              )}
              {s.address && (
                <div className="flex items-center gap-1.5 truncate">
                  <MapPin size={11} /> {s.address.replace(/\n/g, ", ")}
                </div>
              )}
              {!s.email && !s.phone && !s.address && <div className="text-muted/70">No contact info yet</div>}
            </div>
          </div>
          <ChevronRight size={16} className="shrink-0 text-muted" />
        </div>

        <div className="grid grid-cols-3 gap-2 border-t border-line pt-3 text-center">
          <Stat label="Purchases" value={String(s.purchases)} />
          <Stat label="Txns" value={String(s.transactions)} />
          <Stat label="Spend" value={money(s.totalSpend)} />
        </div>
      </Card>
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="tabular text-[15px] font-semibold text-ink">{value}</div>
      <div className="text-[11px] text-muted">{label}</div>
    </div>
  );
}
