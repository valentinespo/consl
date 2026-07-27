import { MapPin } from "@/components/icons";

const boxCls =
  "w-full rounded-lg border border-border bg-surface pl-9 pr-3 py-2 text-[13px] leading-relaxed text-ink outline-none transition-colors focus:border-accent-strong";

/** An editable multi-line address, styled to read as an address rather than a plain box:
 *  a location pin and a street-address placeholder. */
export function AddressInput({
  value,
  onChange,
  rows = 3,
  placeholder = "Street address\nCity, State ZIP\nCountry",
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <MapPin size={15} className="pointer-events-none absolute left-3 top-[11px] text-muted" />
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={rows} placeholder={placeholder} className={`${boxCls} resize-y`} />
    </div>
  );
}

/** A read-only address, styled to match the editable field (used where the value comes from
 *  elsewhere, e.g. a facility inheriting its supplier's address). */
export function AddressDisplay({ value, empty }: { value: string | null; empty?: string }) {
  return (
    <div className="relative">
      <MapPin size={15} className="pointer-events-none absolute left-3 top-[11px] text-muted" />
      <div className={`${boxCls} min-h-[44px] whitespace-pre-line bg-surface-2/60`}>
        {value?.trim() ? value : <span className="text-muted">{empty ?? "No address on file."}</span>}
      </div>
    </div>
  );
}
