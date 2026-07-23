"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { Field, SaveBar, inputCls } from "@/components/FormKit";
import { updateProductChannels } from "@/app/catalog/actions";

export type ProductChannels = {
  id: string;
  barcode: string | null;
  asin: string | null;
  sellerSku: string | null;
  fnsku: string | null;
  shopifyProductId: string | null;
  shopifyVariantId: string | null;
  shopifySku: string | null;
  tiktokProductId: string | null;
  tiktokSku: string | null;
};

const FIELDS = ["barcode", "asin", "sellerSku", "fnsku", "shopifyProductId", "shopifyVariantId", "shopifySku", "tiktokProductId", "tiktokSku"] as const;
type FieldKey = (typeof FIELDS)[number];

function Channel({ name, tint, children, note }: { name: string; tint: string; children: React.ReactNode; note?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface-2/40 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="h-2 w-2 rounded-sm" style={{ background: tint }} />
        <span className="text-[13px] font-semibold text-ink">{name}</span>
        {note && <span className="ml-auto text-[11px] text-muted">{note}</span>}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">{children}</div>
    </div>
  );
}

/** Per-channel identifiers. Amazon's already drive the restock sync; Shopify and TikTok are
 *  stored now so the mapping exists before those integrations are switched on. */
export function ChannelMapping({ product }: { product: ProductChannels }) {
  const router = useRouter();
  const initial = Object.fromEntries(FIELDS.map((k) => [k, product[k] ?? ""])) as Record<FieldKey, string>;
  const [v, setV] = useState<Record<FieldKey, string>>(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const set = (k: FieldKey) => (e: React.ChangeEvent<HTMLInputElement>) => setV((p) => ({ ...p, [k]: e.target.value }));
  const dirty = FIELDS.some((k) => v[k].trim() !== (product[k] ?? ""));

  async function save() {
    setError(null);
    setPending(true);
    const res = await updateProductChannels({ id: product.id, ...v });
    setPending(false);
    if (!res.ok) {
      setError("Could not save.");
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <Card>
      <div className="mb-1 text-[12px] font-medium uppercase tracking-wide text-muted">Sales channels</div>
      <p className="mb-4 text-[12.5px] text-muted">
        These IDs link this product to each marketplace. Amazon&apos;s are used by the restock dashboard today; Shopify and
        TikTok are stored ready for when those connections go live.
      </p>

      <div className="space-y-3">
        <Field label="Barcode (UPC / EAN / GTIN)" hint="Shared across every channel — fill this in first if you have it.">
          <input value={v.barcode} onChange={set("barcode")} placeholder="e.g. 850043284017" className={`${inputCls} sm:max-w-xs`} />
        </Field>

        <Channel name="Amazon" tint="#f59e0b" note="used by the restock sync">
          <Field label="ASIN">
            <input value={v.asin} onChange={set("asin")} placeholder="B0DQ62R6Q3" className={inputCls} />
          </Field>
          <Field label="Seller SKU">
            <input value={v.sellerSku} onChange={set("sellerSku")} placeholder="QC-6LN8-7BT8" className={inputCls} />
          </Field>
          <Field label="FNSKU">
            <input value={v.fnsku} onChange={set("fnsku")} placeholder="X004ABCDEF" className={inputCls} />
          </Field>
        </Channel>

        <Channel name="Shopify" tint="#16a34a" note="mapping only for now">
          <Field label="Product ID">
            <input value={v.shopifyProductId} onChange={set("shopifyProductId")} placeholder="8123456789012" className={inputCls} />
          </Field>
          <Field label="Variant ID">
            <input value={v.shopifyVariantId} onChange={set("shopifyVariantId")} placeholder="44123456789012" className={inputCls} />
          </Field>
          <Field label="SKU">
            <input value={v.shopifySku} onChange={set("shopifySku")} placeholder="Your Shopify SKU" className={inputCls} />
          </Field>
        </Channel>

        <Channel name="TikTok Shop" tint="#2563eb" note="mapping only for now">
          <Field label="Product ID">
            <input value={v.tiktokProductId} onChange={set("tiktokProductId")} placeholder="17291234567890" className={inputCls} />
          </Field>
          <Field label="Seller SKU">
            <input value={v.tiktokSku} onChange={set("tiktokSku")} placeholder="Your TikTok SKU" className={inputCls} />
          </Field>
        </Channel>
      </div>

      <SaveBar dirty={dirty} pending={pending} error={error} saved={saved} onSave={save} onReset={() => setV(initial)} label="Save channel mapping" />
    </Card>
  );
}
