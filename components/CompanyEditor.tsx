"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { SelectMenu } from "@/components/SelectMenu";
import { BrandingCard, ImageSlot, type Branding } from "@/components/BrandingCard";
import { Field, SaveBar, inputCls } from "@/components/FormKit";
import { AddressInput } from "@/components/AddressField";
import { updateCompanyProfile } from "@/app/settings/actions";

/** Lets a parent trigger this editor's save (the onboarding wizard's Continue saves for the
 *  user instead of making them find the Save button). Resolves true when there was nothing to
 *  save or the save succeeded. */
export type EditorSaveRef = React.MutableRefObject<(() => Promise<boolean>) | null>;

export type CompanyForEdit = {
  name: string;
  legalName: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  currencySymbol: string;
  currencyCode: string;
  locale: string;
  brandInk: string;
  brandBand: string;
  logoUrl: string | null;
  iconUrl: string | null;
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

export function CompanyEditor({
  company,
  isOwner,
  saveRef,
  hideSaveBar = false,
  onDirtyState,
}: {
  company: CompanyForEdit;
  isOwner: boolean;
  saveRef?: EditorSaveRef;
  /** The onboarding wizard saves through its floating bar — hide the page-style SaveBar. */
  hideSaveBar?: boolean;
  /** Reports dirty state upward (null = clean) with save/discard the wizard bar can drive. */
  onDirtyState?: (s: { save: () => Promise<string | null>; discard: () => void } | null) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(company.name);
  const [legalName, setLegalName] = useState(company.legalName ?? "");
  const [address, setAddress] = useState(company.address ?? "");
  const [email, setEmail] = useState(company.email ?? "");
  const [phone, setPhone] = useState(company.phone ?? "");
  const [currencySymbol, setCurrencySymbol] = useState(company.currencySymbol);
  const [currencyCode, setCurrencyCode] = useState(company.currencyCode);
  const [locale, setLocale] = useState(company.locale);
  const [brandInk, setBrandInk] = useState(company.brandInk);
  const [brandBand, setBrandBand] = useState(company.brandBand);
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
    locale !== company.locale ||
    brandInk !== company.brandInk ||
    brandBand !== company.brandBand;

  function reset() {
    setName(company.name);
    setLegalName(company.legalName ?? "");
    setAddress(company.address ?? "");
    setEmail(company.email ?? "");
    setPhone(company.phone ?? "");
    setCurrencySymbol(company.currencySymbol);
    setCurrencyCode(company.currencyCode);
    setLocale(company.locale);
    setBrandInk(company.brandInk);
    setBrandBand(company.brandBand);
    setError(null);
  }

  async function save(): Promise<boolean> {
    setError(null);
    setPending(true);
    const res = await updateCompanyProfile({ name, legalName, address, email, phone, currencySymbol, currencyCode, locale, brandInk, brandBand });
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return false;
    }
    setSaved(true);
    router.refresh();
    return true;
  }

  // Re-assigned every render so the parent always calls the latest state. Clean save = no-op.
  useEffect(() => {
    if (!saveRef) return;
    saveRef.current = () => (dirty ? save() : Promise.resolve(true));
    return () => {
      saveRef.current = null;
    };
  });

  // Wizard-bar integration: report on dirty flips; the stable wrappers read the latest closures.
  const barRef = useRef({ save, reset });
  barRef.current = { save, reset };
  useEffect(() => {
    if (!onDirtyState) return;
    onDirtyState(
      dirty
        ? {
            save: async () => ((await barRef.current.save()) ? null : "Couldn't save the company details — check the form."),
            discard: () => barRef.current.reset(),
          }
        : null,
    );
    return () => onDirtyState(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-report on dirty flips only
  }, [dirty]);

  return (
    <>
      <Card>
      <div className="mb-1 text-[12px] font-medium uppercase tracking-wide text-muted">Company profile</div>
      <p className="mb-4 text-[12.5px] text-muted">
        Shown across the app and printed as the sender on every purchase order you generate.
      </p>
      <div className="space-y-3">
        {/* The company's own mark sits with its name — that's the pair you see in the switcher. */}
        <div className="sm:max-w-[260px]">
          <ImageSlot
            kind="icon"
            url={company.iconUrl}
            title="Company mark (isologo)"
            hint="Square icon shown beside the company name in the switcher."
            square
            disabled={!isOwner}
            onChanged={() => router.refresh()}
          />
        </div>
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
            <SelectMenu
              value={locale}
              onChange={setLocale}
              ariaLabel="Number and date format"
              options={[
                ...(LOCALES.some((l) => l.value === locale) ? [] : [{ value: locale, label: locale }]),
                ...LOCALES.map((l) => ({ value: l.value, label: l.label })),
              ]}
            />
          </Field>
        </div>
      </div>
      </Card>

      <BrandingCard
        branding={{
          name: company.name,
          logoUrl: company.logoUrl,
          iconUrl: company.iconUrl,
          brandInk: company.brandInk,
          brandBand: company.brandBand,
        }}
        ink={brandInk}
        band={brandBand}
        onInk={setBrandInk}
        onBand={setBrandBand}
        isOwner={isOwner}
      />

      {isOwner ? (
        !hideSaveBar && <SaveBar dirty={dirty} pending={pending} error={error} saved={saved} onSave={save} onReset={reset} />
      ) : (
        dirty && (
          <p className="mt-4 text-[12.5px] text-muted">Only an owner can change the company profile.</p>
        )
      )}
    </>
  );
}
