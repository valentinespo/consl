"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { Field, SaveBar, inputCls } from "@/components/FormKit";
import { AddressInput } from "@/components/AddressField";
import { updateCompanyProfile } from "@/app/settings/actions";

export type CompanyForEdit = {
  name: string;
  legalName: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  currencySymbol: string;
  currencyCode: string;
  locale: string;
};

/** How money and dates are written. The code itself means nothing to most people, so each option
 *  is labelled by region and the field shows a live sample underneath. */
const LOCALES = [
  { value: "en-US", label: "United States" },
  { value: "en-GB", label: "United Kingdom" },
  { value: "en-CA", label: "Canada" },
  { value: "en-AU", label: "Australia" },
  { value: "de-DE", label: "Germany" },
  { value: "fr-FR", label: "France" },
  { value: "es-ES", label: "Spain" },
  { value: "es-AR", label: "Argentina" },
  { value: "es-MX", label: "Mexico" },
  { value: "pt-BR", label: "Brazil" },
  { value: "it-IT", label: "Italy" },
  { value: "nl-NL", label: "Netherlands" },
  { value: "ja-JP", label: "Japan" },
];

/** A short "1.234,56 · 26. Juli 2026"-style preview of the selected format. */
function sample(locale: string): string {
  try {
    const n = (1234.56).toLocaleString(locale, { minimumFractionDigits: 2 });
    const d = new Date(Date.UTC(2026, 6, 26)).toLocaleDateString(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
    return `${n} · ${d}`;
  } catch {
    return locale;
  }
}

export function CompanyEditor({ company }: { company: CompanyForEdit }) {
  const router = useRouter();
  const [name, setName] = useState(company.name);
  const [legalName, setLegalName] = useState(company.legalName ?? "");
  const [address, setAddress] = useState(company.address ?? "");
  const [email, setEmail] = useState(company.email ?? "");
  const [phone, setPhone] = useState(company.phone ?? "");
  const [currencySymbol, setCurrencySymbol] = useState(company.currencySymbol);
  const [currencyCode, setCurrencyCode] = useState(company.currencyCode);
  const [locale, setLocale] = useState(company.locale);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty =
    name.trim() !== company.name ||
    legalName.trim() !== (company.legalName ?? "") ||
    address.trim() !== (company.address ?? "") ||
    email.trim() !== (company.email ?? "") ||
    phone.trim() !== (company.phone ?? "") ||
    currencySymbol.trim() !== company.currencySymbol ||
    currencyCode.trim().toUpperCase() !== company.currencyCode ||
    locale !== company.locale;

  function reset() {
    setName(company.name);
    setLegalName(company.legalName ?? "");
    setAddress(company.address ?? "");
    setEmail(company.email ?? "");
    setPhone(company.phone ?? "");
    setCurrencySymbol(company.currencySymbol);
    setCurrencyCode(company.currencyCode);
    setLocale(company.locale);
    setError(null);
  }

  async function save() {
    setError(null);
    setPending(true);
    const res = await updateCompanyProfile({ name, legalName, address, email, phone, currencySymbol, currencyCode, locale });
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
      <div className="mb-1 text-[12px] font-medium uppercase tracking-wide text-muted">Company profile</div>
      <p className="mb-4 text-[12.5px] text-muted">
        Shown across the app and printed as the sender on every purchase order you generate.
      </p>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Company name" hint="Shown in the sidebar and browser tab.">
            <input value={name} onChange={(e) => setName(e.target.value)} className={`${inputCls} font-semibold`} />
          </Field>
          <Field label="Legal name" hint="Printed on documents. Falls back to the company name.">
            <input value={legalName} onChange={(e) => setLegalName(e.target.value)} className={inputCls} placeholder={name} />
          </Field>
        </div>
        <Field label="Address" hint="Appears in the sender block on purchase orders.">
          <AddressInput value={address} onChange={setAddress} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Email">
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className={inputCls} />
          </Field>
          <Field label="Phone">
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Currency symbol" hint="Used when showing money.">
            <input value={currencySymbol} onChange={(e) => setCurrencySymbol(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Currency code" hint="e.g. USD, EUR, GBP.">
            <input value={currencyCode} onChange={(e) => setCurrencyCode(e.target.value.toUpperCase())} className={inputCls} />
          </Field>
          <Field label="Number & date format" hint={`Today looks like ${sample(locale)}.`}>
            <select value={locale} onChange={(e) => setLocale(e.target.value)} className={inputCls}>
              {LOCALES.some((l) => l.value === locale) ? null : <option value={locale}>{locale}</option>}
              {LOCALES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>
      <SaveBar dirty={dirty} pending={pending} error={error} saved={saved} onSave={save} onReset={reset} />
    </Card>
  );
}
