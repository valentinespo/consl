"use client";

import { useState } from "react";
import { Building2 } from "@/components/icons";
import { createCompany } from "@/app/welcome/actions";

/** Common presets so most people never touch the currency fields. "Other" reveals them. */
const PRESETS: { label: string; code: string; symbol: string; locale: string }[] = [
  { label: "US dollar (USD)", code: "USD", symbol: "$", locale: "en-US" },
  { label: "Euro (EUR)", code: "EUR", symbol: "€", locale: "de-DE" },
  { label: "British pound (GBP)", code: "GBP", symbol: "£", locale: "en-GB" },
  { label: "Canadian dollar (CAD)", code: "CAD", symbol: "$", locale: "en-CA" },
  { label: "Australian dollar (AUD)", code: "AUD", symbol: "$", locale: "en-AU" },
  { label: "Argentine peso (ARS)", code: "ARS", symbol: "$", locale: "es-AR" },
  { label: "Mexican peso (MXN)", code: "MXN", symbol: "$", locale: "es-MX" },
  { label: "Brazilian real (BRL)", code: "BRL", symbol: "R$", locale: "pt-BR" },
  { label: "Japanese yen (JPY)", code: "JPY", symbol: "¥", locale: "ja-JP" },
];

const inputCls =
  "h-10 w-full rounded-lg border border-border bg-surface px-3 text-[14px] text-ink outline-none focus:border-accent-strong";

export function WelcomeForm({ additional = false }: { additional?: boolean }) {
  const [name, setName] = useState("");
  const [presetIdx, setPresetIdx] = useState(0);
  const [custom, setCustom] = useState(false);
  const [code, setCode] = useState("USD");
  const [symbol, setSymbol] = useState("$");
  const [locale, setLocale] = useState("en-US");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preset = PRESETS[presetIdx];

  async function submit() {
    setError(null);
    setPending(true);
    const res = await createCompany({
      name,
      currencyCode: custom ? code : preset.code,
      currencySymbol: custom ? symbol : preset.symbol,
      locale: custom ? locale : preset.locale,
    });
    if (!res.ok) {
      setError(res.error);
      setPending(false);
      return;
    }
    // Full reload so the layout picks up the brand-new company for every server component.
    window.location.href = "/";
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-2 p-6">
      <div className="w-full max-w-[440px] rounded-[var(--radius-card)] border border-border bg-surface p-7 shadow-sm">
        <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <Building2 size={20} />
        </span>
        <h1 className="text-[21px] font-semibold tracking-tight text-ink">
          {additional ? "Add another company" : "Set up your company"}
        </h1>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">
          {additional
            ? "A separate workspace with its own products, stock and books. You can switch between your companies at any time from the sidebar."
            : "This is the workspace your products, purchases and production live in. You can change any of it later in Settings."}
        </p>

        <div className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-[12.5px] font-medium text-ink-soft">Company name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim() && !pending) submit();
              }}
              placeholder="e.g. Northwind Coffee"
              className={inputCls}
              autoFocus
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[12.5px] font-medium text-ink-soft">Currency</span>
            <select
              value={custom ? "custom" : String(presetIdx)}
              onChange={(e) => {
                if (e.target.value === "custom") {
                  setCustom(true);
                } else {
                  setCustom(false);
                  setPresetIdx(Number(e.target.value));
                }
              }}
              className={inputCls}
            >
              {PRESETS.map((p, i) => (
                <option key={p.code} value={i}>
                  {p.label}
                </option>
              ))}
              <option value="custom">Something else…</option>
            </select>
          </label>

          {custom && (
            <div className="grid grid-cols-3 gap-2.5">
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-muted">Code</span>
                <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={3} placeholder="USD" className={inputCls} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-muted">Symbol</span>
                <input value={symbol} onChange={(e) => setSymbol(e.target.value)} maxLength={4} placeholder="$" className={inputCls} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-muted">Region</span>
                <input value={locale} onChange={(e) => setLocale(e.target.value)} placeholder="en-US" className={inputCls} />
              </label>
            </div>
          )}

          {error && <div className="rounded-lg tint-red px-3 py-2 text-[12.5px] text-negative">{error}</div>}

          <button
            onClick={submit}
            disabled={pending || !name.trim()}
            className="h-10 w-full rounded-lg bg-ink text-[14px] font-medium text-bg hover:opacity-90 disabled:opacity-40"
          >
            {pending ? "Creating…" : additional ? "Create company" : "Create company"}
          </button>
        </div>
      </div>
    </div>
  );
}
