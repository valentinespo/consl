"use client";

import Image from "next/image";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Lock, Plus, Undo2, X } from "@/components/icons";
import { SelectMenu } from "@/components/SelectMenu";
import { inputCls } from "@/components/FormKit";
import { ROOT_LOGO } from "@/lib/channel-logos";
import { FACILITY_TYPES } from "@/lib/facility-types";
import { mapAmazonShipFrom, createFacilityForShipFrom, mergeChannelPlace, unmergeChannelPlace, setFacilityStockSource } from "@/app/facilities/actions";

export type MappingData = {
  amazonManaged: { id: string; name: string; kind: "FBA" | "AWD" }[];
  shipFrom: { id: string; key: string; label: string; facility: { id: string; name: string } | null; orders: number; active: boolean }[];
  channelPlaces: {
    id: string;
    channel: string;
    label: string;
    active: boolean;
    facility: { id: string; name: string } | null;
    amazonMirror: boolean;
    manual: boolean; // a person pointed this place at another facility ("same place as…")
    awaitingOwn: boolean; // un-merged, own facility due back from the next places sync
    ownFacilityId: string | null; // the facility the sync made for this very place, while it is active
  }[];
  candidates: { id: string; name: string; code: string; type: string }[];
  stockSources: StockSourceInfo[];
};

export type StockSourceInfo = {
  facilityId: string;
  platforms: string[];
  source: string;
  disagreements: { code: string; units: number; other: string; otherUnits: number }[];
};

const PLATFORM: Record<string, string> = { SHOPIFY: "Shopify", TIKTOK: "TikTok" };

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

/** Which platform's count a facility uses when two report it, with where the other one differs. */
function StockSourceControl({ info }: { info: StockSourceInfo }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const pick = (source: string) =>
    start(async () => {
      const r = await setFacilityStockSource(info.facilityId, source);
      if (!r.ok) return setError(r.error ?? "Something went wrong.");
      setError(null);
      router.refresh();
    });
  const name = (p: string) => PLATFORM[p] ?? p;
  return (
    <div className="mt-2 rounded-lg border border-border bg-surface-2/40 px-3 py-2 text-[12px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted">Count stock from</span>
        <div className="inline-flex overflow-hidden rounded-lg border border-border">
          {info.platforms.map((p) => (
            <button
              key={p}
              type="button"
              disabled={pending || p === info.source}
              onClick={() => pick(p)}
              className={`px-2.5 py-1 font-medium ${p === info.source ? "bg-accent-strong text-white" : "bg-surface text-ink-soft hover:text-ink"}`}
            >
              {name(p)}
            </button>
          ))}
        </div>
        <span className="text-muted">{info.platforms.map(name).join(" and ")} both report this place — only one number counts.</span>
      </div>
      {info.disagreements.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-ink-soft">
          <span className={`${PILL} pill-amber`}>Counts disagree</span>
          {info.disagreements.map((d) => (
            <span key={`${d.code}|${d.other}`} className="tabular">
              {d.code}: {name(info.source)} {d.units.toLocaleString()}, {name(d.other)} {d.otherUnits.toLocaleString()}
            </span>
          ))}
        </div>
      ) : (
        <div className="mt-1.5 text-muted">No differences between the two counts so far (a couple of units either way is ignored).</div>
      )}
      {error && <p className="mt-1.5 text-negative">{error}</p>}
    </div>
  );
}

/** One Shopify location or TikTok warehouse: its facility, kept in sync — or pointed at another
 *  facility by a person ("same place as…"), with the way back. */
function ChannelPlaceRow({ place, candidates, source }: { place: MappingData["channelPlaces"][number]; candidates: MappingData["candidates"]; source: StockSourceInfo | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [picking, setPicking] = useState(false);
  const [choice, setChoice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return setError(r.error ?? "Something went wrong.");
      setError(null);
      setPicking(false);
      router.refresh();
    });
  const options = candidates.filter((f) => f.id !== place.ownFacilityId && f.id !== place.facility?.id).map((f) => ({ value: f.id, label: f.name, hint: f.code }));
  const noun = place.channel === "SHOPIFY" ? "location" : "warehouse";
  return (
    <div className="px-4 py-2.5 text-[13px]">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 truncate text-ink">{place.label}</div>
        <div className="flex flex-wrap items-center gap-2">
          {place.facility ? (
            <>
              <span className="text-ink-soft">{place.manual ? `Same place as ${place.facility.name}` : place.facility.name}</span>
              {place.manual ? (
                <span className={`${PILL} pill-chart`}>Set by you</span>
              ) : place.awaitingOwn ? (
                <span className={`${PILL} pill-amber`}>own facility back with the next sync</span>
              ) : (
                <span className={`${PILL} pill-green`}>Automatic</span>
              )}
              {!place.active && <span className={`${PILL} pill-neutral`}>inactive on the platform</span>}
            </>
          ) : (
            <span className={`${PILL} pill-amber`}>not synced yet</span>
          )}
          {!picking && !place.amazonMirror && place.active && options.length > 0 && (
            <button className={btnSecondary} disabled={pending} onClick={() => { setChoice(""); setPicking(true); }}>
              {place.manual ? "Change" : "Same place as…"}
            </button>
          )}
          {!picking && place.manual && (
            <button className={btnSecondary} disabled={pending} onClick={() => act(() => unmergeChannelPlace(place.id))}>
              <Undo2 size={13} /> {pending ? "Working…" : "Own facility again"}
            </button>
          )}
        </div>
      </div>
      {picking && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-2/40 p-3">
          <span className="text-[12.5px] text-muted">This {noun} is the same place as</span>
          <div className="w-[260px]">
            <SelectMenu value={choice} onChange={setChoice} options={[{ value: "", label: "Pick a facility" }, ...options]} />
          </div>
          <button className={btnPrimary} disabled={pending || !choice} onClick={() => act(() => mergeChannelPlace(place.id, choice))}>
            <Check size={13} /> {pending ? "Merging…" : "Merge"}
          </button>
          <button className={btnSecondary} disabled={pending} onClick={() => setPicking(false)}>
            <X size={13} /> Cancel
          </button>
          <p className="basis-full text-[12px] text-muted">
            Its orders and stock count at that facility from now on. Everything its own facility held moves there, and that facility retires. Undo any time with “Own facility again”.
          </p>
        </div>
      )}
      {source && !place.manual && !place.awaitingOwn && <StockSourceControl info={source} />}
      {error && <p className="mt-2 text-[12px] text-negative">{error}</p>}
    </div>
  );
}

export function FacilityMappingClient({ data }: { data: MappingData }) {
  const shopify = data.channelPlaces.filter((p) => p.channel === "SHOPIFY");
  const tiktok = data.channelPlaces.filter((p) => p.channel === "TIKTOK");
  const managed = <span className={`${PILL} pill-neutral`}><Lock size={11} /> Managed</span>;
  const sourceFor = (p: MappingData["channelPlaces"][number]) => (p.facility ? data.stockSources.find((s) => s.facilityId === p.facility!.id) ?? null : null);

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
        <Section channel="SHOPIFY" title="Shopify" hint="Each Shopify location is its own facility, kept in sync automatically. A location that is really one of your other facilities can be pointed at it. Amazon's fulfillment service resolves to Amazon FBA.">
          {shopify.map((p) => (
            <ChannelPlaceRow key={p.id} place={p} candidates={data.candidates} source={sourceFor(p)} />
          ))}
        </Section>
      )}
      {tiktok.length > 0 && (
        <Section channel="TIKTOK" title="TikTok Shop" hint="Each TikTok warehouse is its own facility, kept in sync automatically. A warehouse that is really one of your other facilities (the one Shopify ships from too) can be pointed at it. An Amazon MCF warehouse resolves to Amazon FBA.">
          {tiktok.map((p) => (
            <ChannelPlaceRow key={p.id} place={p} candidates={data.candidates} source={sourceFor(p)} />
          ))}
        </Section>
      )}
      {data.amazonManaged.length === 0 && data.shipFrom.length === 0 && shopify.length === 0 && tiktok.length === 0 && (
        <p className="text-[13px] text-muted">Connect a sales channel and its places will appear here.</p>
      )}
    </div>
  );
}
