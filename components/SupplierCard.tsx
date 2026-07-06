"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Mail, Phone, MapPin } from "lucide-react";
import { Card, FacilityTag } from "@/components/ui";
import { ImageUpload } from "@/components/ImageUpload";
import { updateSupplier } from "@/app/suppliers/actions";
import { money } from "@/lib/format";

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

const inputCls = "h-8 w-full rounded-lg border border-border bg-surface px-2 text-[13px] text-ink outline-none focus:border-accent-strong";

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
}

export function SupplierCard({ supplier: s, facilities }: { supplier: SupplierRow; facilities: { id: string; code: string; name: string }[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState(s.email ?? "");
  const [phone, setPhone] = useState(s.phone ?? "");
  const [address, setAddress] = useState(s.address ?? "");
  const [facilityId, setFacilityId] = useState(s.facilityId ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    email.trim() !== (s.email ?? "") || phone.trim() !== (s.phone ?? "") || address.trim() !== (s.address ?? "") || (facilityId || null) !== s.facilityId;

  async function save() {
    setError(null);
    setPending(true);
    const res = await updateSupplier({ id: s.id, email, phone, address, facilityId: facilityId || null });
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setEditing(false);
    router.refresh();
  }
  function cancel() {
    setEmail(s.email ?? "");
    setPhone(s.phone ?? "");
    setAddress(s.address ?? "");
    setFacilityId(s.facilityId ?? "");
    setError(null);
    setEditing(false);
  }

  return (
    <Card className="relative flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <ImageUpload
          kind="supplier"
          id={s.id}
          url={s.photoUrl}
          circle
          size={48}
          editable={editing}
          fallback={
            <span className="flex h-full w-full items-center justify-center bg-accent text-[15px] font-semibold text-ink">{initials(s.name)}</span>
          }
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold text-ink">{s.name}</span>
            {s.facilityCode && !editing && <FacilityTag code={s.facilityCode} />}
          </div>
          {!editing && (
            <div className="mt-0.5 space-y-0.5 text-[12px] text-muted">
              {s.email && (
                <div className="flex items-center gap-1.5"><Mail size={11} /> {s.email}</div>
              )}
              {s.phone && (
                <div className="flex items-center gap-1.5"><Phone size={11} /> {s.phone}</div>
              )}
              {s.address && (
                <div className="flex items-center gap-1.5"><MapPin size={11} /> {s.address.replace(/\n/g, ", ")}</div>
              )}
              {!s.email && !s.phone && !s.address && <div className="text-muted/70">No contact info yet — click the pencil.</div>}
            </div>
          )}
        </div>
        {!editing && (
          <button onClick={() => setEditing(true)} title="Edit supplier" className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink-soft">
            <Pencil size={14} />
          </button>
        )}
      </div>

      {editing && (
        <div className="space-y-1.5">
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" className={inputCls} />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" className={inputCls} />
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Address" className={inputCls} />
          <select value={facilityId} onChange={(e) => setFacilityId(e.target.value)} className={inputCls}>
            <option value="">Not a facility (regular vendor)</option>
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>
                Facility: {f.code} — {f.name}
              </option>
            ))}
          </select>
          {error && <div className="text-[11px] text-negative">{error}</div>}
          <div className="flex gap-1.5 pt-0.5">
            <button onClick={save} disabled={pending || !dirty} className="rounded-lg bg-ink px-2.5 py-1 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-40">
              {pending ? "…" : "Save"}
            </button>
            <button onClick={cancel} disabled={pending} className="rounded-lg border border-border px-2.5 py-1 text-[12px] text-ink-soft hover:bg-surface-2">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 border-t border-line pt-3 text-center">
        <Stat label="Purchases" value={String(s.purchases)} />
        <Stat label="Txns" value={String(s.transactions)} />
        <Stat label="Spend" value={money(s.totalSpend)} />
      </div>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[15px] font-semibold text-ink tabular">{value}</div>
      <div className="text-[11px] text-muted">{label}</div>
    </div>
  );
}
