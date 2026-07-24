"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { ImageUpload } from "@/components/ImageUpload";
import { Field, SaveBar, inputCls } from "@/components/FormKit";
import { initials } from "@/lib/initials";
import { updateSupplier } from "@/app/suppliers/actions";

export type SupplierForEdit = {
  id: string;
  name: string;
  photoUrl: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  facilityId: string | null;
};

export function SupplierEditor({
  supplier: s,
  facilities,
}: {
  supplier: SupplierForEdit;
  facilities: { id: string; code: string; name: string }[];
}) {
  const router = useRouter();
  const [name, setName] = useState(s.name);
  const [email, setEmail] = useState(s.email ?? "");
  const [phone, setPhone] = useState(s.phone ?? "");
  const [address, setAddress] = useState(s.address ?? "");
  const [notes, setNotes] = useState(s.notes ?? "");
  const [facilityId, setFacilityId] = useState(s.facilityId ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty =
    name.trim() !== s.name ||
    email.trim() !== (s.email ?? "") ||
    phone.trim() !== (s.phone ?? "") ||
    address.trim() !== (s.address ?? "") ||
    notes.trim() !== (s.notes ?? "") ||
    (facilityId || null) !== s.facilityId;

  function reset() {
    setName(s.name);
    setEmail(s.email ?? "");
    setPhone(s.phone ?? "");
    setAddress(s.address ?? "");
    setNotes(s.notes ?? "");
    setFacilityId(s.facilityId ?? "");
    setError(null);
  }

  async function save() {
    setError(null);
    setPending(true);
    const res = await updateSupplier({ id: s.id, name, email, phone, address, notes, facilityId: facilityId || null });
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <Card>
      <div className="mb-4 text-[12px] font-medium uppercase tracking-wide text-muted">Details</div>
      <div className="flex flex-col gap-5 sm:flex-row">
        <div className="shrink-0">
          <ImageUpload
            kind="supplier"
            id={s.id}
            url={s.photoUrl}
            circle
            size={96}
            editable
            fallback={
              <span className="flex h-full w-full items-center justify-center bg-accent text-[24px] font-semibold text-ink">{initials(s.name)}</span>
            }
          />
          <div className="mt-1.5 text-center text-[11px] text-muted">Photo</div>
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          <Field label="Supplier name">
            <input value={name} onChange={(e) => setName(e.target.value)} className={`${inputCls} font-semibold`} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Email">
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className={inputCls} />
            </Field>
            <Field label="Phone">
              <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} />
            </Field>
          </div>
          <Field label="Address">
            <textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2} className={`${inputCls} h-auto resize-y py-2`} />
          </Field>
          <Field label="This supplier is also one of my facilities" hint="Link it when you both pay this company and hold stock there.">
            <select value={facilityId} onChange={(e) => setFacilityId(e.target.value)} className={inputCls}>
              <option value="">Not a facility (regular vendor)</option>
              {facilities.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.code} — {f.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Notes" hint="Internal only.">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={`${inputCls} h-auto resize-y py-2`} />
          </Field>
        </div>
      </div>
      <SaveBar dirty={dirty} pending={pending} error={error} saved={saved} onSave={save} onReset={reset} />
    </Card>
  );
}
