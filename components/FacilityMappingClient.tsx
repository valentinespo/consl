"use client";

import Image from "next/image";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Lock, Plus, X } from "@/components/icons";
import { SelectMenu } from "@/components/SelectMenu";
import { inputCls } from "@/components/FormKit";
import { ROOT_LOGO } from "@/lib/channel-logos";
import { FACILITY_TYPES } from "@/lib/facility-types";
import { mapAmazonShipFrom, createFacilityForShipFrom } from "@/app/facilities/actions";

export type MappingData = {
  amazonManaged: { id: string; name: string; kind: "FBA" | "AWD" }[];
  shipFrom: { id: string; key: string; label: string; facility: { id: string; name: string } | null; orders: number; active: boolean }[];
  channelPlaces: { id: string; channel: string; label: string; active: boolean; facility: { id: string; name: string } | null }[];
  candidates: { id: string; name: string; code: string; type: string }[];
};

const PILL = "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium";
const btnPrimary = "inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent-strong px-3 text-[12.5px] font-medium text-white hover:opacity-90 disabled:opacity-50";
const btnSecondary = "inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[12.5px] font-medium text-ink-soft hover:text-ink disabled:opacity-50";

function Section({ channel, title, hint, children }: { channel: string; title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="mb-5 rounded-[var(--radius-card)] border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        {ROOT_LOGO[channel] && <Image src={ROOT_LOGO[channel]} alt="" width={18} height={18} className="rounded-[4px]" />}
        <div>
          <div className="text-[14px] font-semibold text-ink">{title}</div>
          <div className="text-[12px] text-muted">{hint}</div>
        </div>
      </div>
      <div className="divide-y divide-line">{children}</div>
    </section>
  );
}

function Row({ label, sub, right }: { label: string; sub?: string; right: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5 text-[13px]">
      <div className="min-w-0">
        <div className="truncate text-ink">{label}</div>
        {sub && <div className="text-[11.5px] text-muted">{sub}</div>}
      </div>
      <div className="flex items-center gap-2">{right}</div>
    </div>
  );
}

/** One merchant-fulfilled ship-from address: pick a facility, or create one from the address. */
function ShipFromRow({ place, candidates }: { place: MappingData["shipFrom"][number]; candidates: MappingData["candidates"] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [choice, setChoice] = useState(place.facility?.id ?? "");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState(place.label.split(" · ")[0] ?? "");
  const [type, setType] = useState("warehouse");
  const [error, setError] = useState<string | null>(null);
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return setError(r.error ?? "Something went wrong.");
      setError(null);
      setCreating(false);
      router.refresh();
    });
  const dirty = choice !== (place.facility?.id ?? "");
  return (
    <div className="px-4 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[13px]">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-ink">{place.label}</span>
            {place.facility ? (
              <span className={`${PILL} pill-green`}>mapped</span>
            ) : (
              <span className={`${PILL} pill-amber`}>needs a facility</span>
            )}
          </div>
          <div className="text-[11.5px] text-muted">
            {place.orders.toLocaleString()} merchant-fulfilled order{place.orders === 1 ? "" : "s"} shipped from here
            {place.facility ? "" : " · priced at average cost until mapped"}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-[260px]">
            <SelectMenu value={choice} onChange={setChoice} options={[{ value: "", label: "No facility" }, ...candidates.map((f) => ({ value: f.id, label: f.name, hint: f.code }))]} />
          </div>
          {dirty && (
            <button className={btnPrimary} disabled={pending} onClick={() => act(() => mapAmazonShipFrom(place.id, choice || null))}>
              <Check size={13} /> {pending ? "Saving…" : "Save"}
            </button>
          )}
          {!creating && (
            <button className={btnSecondary} disabled={pending} onClick={() => setCreating(true)}>
              <Plus size={13} /> New facility
            </button>
          )}
        </div>
      </div>
      {creating && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-2/40 p-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Facility name" className={`${inputCls} max-w-[260px]`} maxLength={60} />
          <div className="w-[200px]">
            <SelectMenu value={type} onChange={setType} options={FACILITY_TYPES.map((t) => ({ value: t.value, label: t.label, hint: t.hint }))} />
          </div>
          <button className={btnPrimary} disabled={pending} onClick={() => act(() => createFacilityForShipFrom(place.id, { name, type }))}>
            <Check size={13} /> {pending ? "Creating…" : "Create & map"}
          </button>
          <button className={btnSecondary} onClick={() => setCreating(false)}>
            <X size={13} /> Cancel
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-[12px] text-negative">{error}</p>}
    </div>
  );
}

export function FacilityMappingClient({ data }: { data: MappingData }) {
  const shopify = data.channelPlaces.filter((p) => p.channel === "SHOPIFY");
  const tiktok = data.channelPlaces.filter((p) => p.channel === "TIKTOK");
  const managed = <span className={`${PILL} pill-neutral`}><Lock size={11} /> Managed</span>;
  const auto = (facility: { name: string } | null, active: boolean) =>
    facility ? (
      <>
        <span className="text-ink-soft">{facility.name}</span>
        <span className={`${PILL} pill-green`}>Automatic</span>
        {!active && <span className={`${PILL} pill-neutral`}>inactive on the platform</span>}
      </>
    ) : (
      <span className={`${PILL} pill-amber`}>not synced yet</span>
    );

  return (
    <div>
      {(data.amazonManaged.length > 0 || data.shipFrom.length > 0) && (
        <Section
          channel="AMAZON"
          title="Amazon"
          hint="Amazon's own warehouses are managed for you. A merchant-fulfilled order ships from one of your places — tell consl which."
        >
          {data.amazonManaged.map((f) => (
            <Row key={f.id} label={f.name} sub={f.kind === "AWD" ? "Amazon Warehousing & Distribution" : "Fulfilled by Amazon"} right={managed} />
          ))}
          {data.shipFrom.length === 0 ? (
            <Row label="Merchant-fulfilled ship-from addresses" sub="None yet — the first merchant-fulfilled order will add its address here." right={<span className="text-[12px] text-muted">nothing to map</span>} />
          ) : (
            data.shipFrom.map((p) => <ShipFromRow key={p.id} place={p} candidates={data.candidates} />)
          )}
        </Section>
      )}
      {shopify.length > 0 && (
        <Section channel="SHOPIFY" title="Shopify" hint="Each Shopify location is its own facility, kept in sync automatically. Amazon's fulfillment service resolves to Amazon FBA.">
          {shopify.map((p) => (
            <Row key={p.id} label={p.label} right={auto(p.facility, p.active)} />
          ))}
        </Section>
      )}
      {tiktok.length > 0 && (
        <Section channel="TIKTOK" title="TikTok Shop" hint="Each TikTok warehouse is its own facility, kept in sync automatically. An Amazon MCF warehouse resolves to Amazon FBA.">
          {tiktok.map((p) => (
            <Row key={p.id} label={p.label} right={auto(p.facility, p.active)} />
          ))}
        </Section>
      )}
      {data.amazonManaged.length === 0 && data.shipFrom.length === 0 && shopify.length === 0 && tiktok.length === 0 && (
        <p className="text-[13px] text-muted">Connect a sales channel and its places will appear here.</p>
      )}
    </div>
  );
}
