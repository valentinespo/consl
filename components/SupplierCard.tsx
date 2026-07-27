import Link from "next/link";
import { Mail, Phone, MapPin, ChevronRight, Info, type LucideIcon } from "@/components/icons";
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
            {/* Each line keeps its icon: `shrink-0` on the icon and `truncate` on the text, not on
                the row. With truncate on the flex row the icon had no minimum width, so flexbox
                collapsed it to 0px whenever the text was long — which is why a short email kept
                its icon and a long address silently lost its pin. */}
            <div className="mt-0.5 space-y-0.5 text-[12px] text-muted">
              {s.email && <ContactLine icon={Mail} text={s.email} />}
              {s.phone && <ContactLine icon={Phone} text={s.phone} />}
              {s.address && <ContactLine icon={MapPin} text={s.address.replace(/\n/g, ", ")} />}
              {!s.email && !s.phone && !s.address && (
                <ContactLine icon={Info} text="No contact info yet" faded />
              )}
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

/** One contact line. The icon never shrinks; only the text truncates. */
function ContactLine({
  icon: Icon,
  text,
  faded,
}: {
  icon: LucideIcon;
  text: string;
  faded?: boolean;
}) {
  return (
    <div className={`flex items-center gap-1.5 ${faded ? "text-muted/70" : ""}`}>
      <Icon size={11} className="shrink-0" />
      <span className="truncate">{text}</span>
    </div>
  );
}
