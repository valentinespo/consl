"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { Field, SaveBar, inputCls } from "@/components/FormKit";
import { FACILITY_TYPES } from "@/lib/facility-types";
import { updateFacility } from "@/app/facilities/actions";

export type FacilityForEdit = {
  id: string;
  code: string;
  name: string;
  type: string;
  legalName: string | null;
  address: string | null;
  notes: string | null;
  supplierId: string | null;
};

export type SupplierOption = { id: string; name: string; facilityId: string | null; address: string | null };

export function FacilityEditor({ facility, suppliers }: { facility: FacilityForEdit; suppliers: SupplierOption[] }) {
  const router = useRouter();
  const [code, setCode] = useState(facility.code);
  const [name, setName] = useState(facility.name);
  const [type, setType] = useState(facility.type);
  const [legalName, setLegalName] = useState(facility.legalName ?? "");
  const [address, setAddress] = useState(facility.address ?? "");
  const [notes, setNotes] = useState(facility.notes ?? "");
  const [supplierId, setSupplierId] = useState(facility.supplierId ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty =
    code.trim().toUpperCase() !== facility.code ||
    name.trim() !== facility.name ||
    type !== facility.type ||
    legalName.trim() !== (facility.legalName ?? "") ||
    address.trim() !== (facility.address ?? "") ||
    notes.trim() !== (facility.notes ?? "") ||
    (supplierId || null) !== facility.supplierId;

  function reset() {
    setCode(facility.code);
    setName(facility.name);
    setType(facility.type);
    setLegalName(facility.legalName ?? "");
    setAddress(facility.address ?? "");
    setNotes(facility.notes ?? "");
    setSupplierId(facility.supplierId ?? "");
    setError(null);
  }

  async function save() {
    setError(null);
    setPending(true);
    const res = await updateFacility({ id: facility.id, code, name, type, legalName, address, notes, supplierId: supplierId || null });
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSaved(true);
    router.refresh();
  }

  const hint = FACILITY_TYPES.find((t) => t.value === type)?.hint;
  // When this facility IS a supplier, that supplier owns the address — don't ask for it twice.
  const linkedSupplier = suppliers.find((s) => s.id === supplierId) ?? null;

  return (
    <Card>
      <div className="mb-4 text-[12px] font-medium uppercase tracking-wide text-muted">Details</div>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[140px_1fr_200px]">
          <Field label="Short code" hint="Used on lot and PO numbers.">
            <input value={code} onChange={(e) => setCode(e.target.value)} className={`${inputCls} font-semibold uppercase`} />
          </Field>
          <Field label="Facility name">
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Type" hint={hint}>
            <select value={type} onChange={(e) => setType(e.target.value)} className={inputCls}>
              {FACILITY_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field
          label="Is this facility also a supplier you pay?"
          hint="The same link you can set from the Suppliers page — editable from either side."
        >
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={`${inputCls} sm:max-w-md`}>
            <option value="">No — you don&apos;t pay this location (your own warehouse, or a 3PL billed elsewhere)</option>
            {suppliers
              .filter((s) => !s.facilityId || s.facilityId === facility.id)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </Field>

        {/* One address, one place. Linked to a supplier → the supplier's address is used. */}
        {linkedSupplier ? (
          <Field label="Address">
            <div className="rounded-lg border border-border bg-surface-2/60 px-3 py-2 text-[13px] text-ink-soft">
              {linkedSupplier.address?.trim() ? (
                <span className="whitespace-pre-line">{linkedSupplier.address}</span>
              ) : (
                <span className="text-muted">No address on {linkedSupplier.name} yet.</span>
              )}
            </div>
            <span className="mt-1 block text-[11px] text-muted">
              Comes from the supplier <span className="font-medium text-ink-soft">{linkedSupplier.name}</span> — edit it on
              that supplier&apos;s page so it stays in one place.
            </span>
          </Field>
        ) : (
          <Field label="Address" hint="Where this location is. Used as the vendor address if you send it a purchase order.">
            <textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={3} className={`${inputCls} h-auto resize-y py-2`} />
          </Field>
        )}

        <Field label="Notes" hint="Internal only.">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={`${inputCls} h-auto resize-y py-2`} />
        </Field>
      </div>
      <SaveBar dirty={dirty} pending={pending} error={error} saved={saved} onSave={save} onReset={reset} />
    </Card>
  );
}
