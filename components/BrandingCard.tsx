"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload, Trash2 } from "lucide-react";
import { Card } from "@/components/ui";
import { uploadBrandImage, removeBrandImage, type BrandImageKind } from "@/app/settings/actions";

export type Branding = {
  name: string;
  logoUrl: string | null;
  iconUrl: string | null;
  brandInk: string;
  brandBand: string;
};

/** One upload slot. `square` frames an isologo; the wide one previews on its band colour. */
function ImageSlot({
  kind,
  url,
  title,
  hint,
  square,
  backdrop,
  disabled,
  onChanged,
}: {
  kind: BrandImageKind;
  url: string | null;
  title: string;
  hint: string;
  square?: boolean;
  backdrop?: string;
  disabled: boolean;
  onChanged: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy(true);
    const fd = new FormData();
    fd.set("kind", kind);
    fd.set("file", file);
    const res = await uploadBrandImage(fd);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onChanged();
  }

  return (
    <div className="rounded-xl border border-border p-3">
      <div className="text-[12.5px] font-medium text-ink">{title}</div>
      <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">{hint}</p>

      <div
        className={`mt-2.5 flex items-center justify-center overflow-hidden rounded-lg border border-border ${
          square ? "h-[72px] w-[72px]" : "h-[72px] w-full"
        }`}
        style={{ background: backdrop ?? "var(--surface-2, #f6f7f8)" }}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={title} className="max-h-[56px] max-w-[90%] object-contain" />
        ) : (
          <span className="text-[11px] text-muted">None yet</span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0])}
        />
        <button
          onClick={() => input.current?.click()}
          disabled={busy || disabled}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[12px] text-ink-soft hover:bg-surface-2 disabled:opacity-50"
        >
          <Upload size={13} />
          {busy ? "Uploading…" : url ? "Replace" : "Upload"}
        </button>
        {url && (
          <button
            onClick={async () => {
              setBusy(true);
              const res = await removeBrandImage(kind);
              setBusy(false);
              if (!res.ok) setError(res.error);
              else onChanged();
            }}
            disabled={busy || disabled}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] text-muted hover:text-negative disabled:opacity-50"
          >
            <Trash2 size={13} />
            Remove
          </button>
        )}
      </div>
      {error && <div className="mt-1.5 text-[11.5px] text-negative">{error}</div>}
    </div>
  );
}

/** Blend two hex colours — mirrors the derivation in lib/po-pdf.ts so the preview matches. */
function mix(a: string, b: string, t: number): string {
  const ok = (c: string) => /^#[0-9a-fA-F]{6}$/.test(c);
  if (!ok(a) || !ok(b)) return a;
  const ch = (c: string, i: number) => parseInt(c.slice(1 + i * 2, 3 + i * 2), 16);
  const out = [0, 1, 2].map((i) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t));
  return `#${out.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

export function BrandingCard({
  branding,
  ink,
  band,
  onInk,
  onBand,
  isOwner,
}: {
  branding: Branding;
  ink: string;
  band: string;
  onInk: (v: string) => void;
  onBand: (v: string) => void;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [, startRefresh] = useTransition();
  const refresh = () => startRefresh(() => router.refresh());

  // Mirrors lib/po-pdf.ts: lighten toward grey, then drain saturation so body copy stays neutral.
  const muted = (() => {
    const base = mix(ink, "#8a8f98", 0.45);
    if (!/^#[0-9a-fA-F]{6}$/.test(base)) return base;
    const ch = (i: number) => parseInt(base.slice(1 + i * 2, 3 + i * 2), 16);
    const lum = Math.round(0.299 * ch(0) + 0.587 * ch(1) + 0.114 * ch(2));
    const grey = `#${[lum, lum, lum].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
    return mix(base, grey, 0.5);
  })();

  return (
    <Card className="mt-4">
      <div className="mb-1 text-[12px] font-medium uppercase tracking-wide text-muted">Branding</div>
      <p className="mb-4 max-w-[62ch] text-[12.5px] text-muted">
        Purchase orders go out to your suppliers under your name, so they use your logo and colours —
        not ours. The square mark is what you&apos;ll see beside this company in the switcher.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <ImageSlot
          kind="logo"
          url={branding.logoUrl}
          title="Purchase order logo"
          hint="Wide mark printed across the top of every PO. PNG with a transparent background works best."
          backdrop={band}
          disabled={!isOwner}
          onChanged={refresh}
        />
        <ImageSlot
          kind="icon"
          url={branding.iconUrl}
          title="Company mark (isologo)"
          hint="Square icon shown next to the company name in the switcher, under the SellerOps logo."
          square
          disabled={!isOwner}
          onChanged={refresh}
        />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <ColorField label="Main colour" hint="Headings, the dark bar and totals." value={ink} onChange={onInk} disabled={!isOwner} />
        <ColorField label="Header band" hint="The panel behind your logo." value={band} onChange={onBand} disabled={!isOwner} />
      </div>

      {/* A miniature of the real PO header, using the same colour derivation as the PDF. */}
      <div className="mt-4">
        <div className="mb-1.5 text-[11.5px] font-medium text-muted">How a purchase order will look</div>
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="flex items-center justify-between px-4 py-4" style={{ background: band }}>
            {branding.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={branding.logoUrl} alt="" className="max-h-[24px] max-w-[45%] object-contain" />
            ) : (
              <span className="truncate text-[15px] font-bold" style={{ color: ink }}>
                {branding.name}
              </span>
            )}
            <span className="text-[12px] font-bold tracking-wide" style={{ color: ink }}>
              PURCHASE ORDER
            </span>
          </div>
          <div className="flex items-center justify-between px-4 py-2" style={{ background: ink }}>
            <span className="text-[10px] font-bold tracking-wide text-white">PO DATE: 07/26/2026</span>
            <span className="text-[10px] font-bold tracking-wide text-white">PURCHASE ORDER #21</span>
          </div>
          <div className="bg-surface px-4 py-3">
            <div className="flex items-center justify-between text-[10.5px] font-bold" style={{ color: ink }}>
              <span>ITEM DESCRIPTION</span>
              <span>AMOUNT</span>
            </div>
            <div className="mt-1 h-px" style={{ background: ink }} />
            <div className="mt-1.5 flex items-center justify-between text-[11px]" style={{ color: muted }}>
              <span>Sample line item</span>
              <span className="tabular">1,250.00</span>
            </div>
          </div>
        </div>
      </div>

      {!isOwner && (
        <div className="mt-3 text-[11.5px] text-muted">Only an owner can change the company&apos;s branding.</div>
      )}
    </Card>
  );
}

function ColorField({
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12.5px] font-medium text-ink-soft">{label}</span>
      <span className="flex items-center gap-2">
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="h-9 w-10 shrink-0 cursor-pointer rounded-lg border border-border bg-surface p-1 disabled:cursor-not-allowed"
          aria-label={label}
        />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          spellCheck={false}
          className="h-9 w-full rounded-lg border border-border bg-surface px-2.5 font-mono text-[13px] text-ink outline-none focus:border-accent-strong disabled:opacity-60"
        />
      </span>
      <span className="mt-1 block text-[11.5px] text-muted">{hint}</span>
    </label>
  );
}

