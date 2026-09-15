"use client";

import Image from "next/image";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Lock, Plus, X } from "@/components/icons";
import { SelectMenu } from "@/components/SelectMenu";
import { inputCls } from "@/components/FormKit";
import { ROOT_LOGO } from "@/lib/channel-logos";
import { FACILITY_TYPES } from "@/lib/facility-types";
import { mapAmazonShipFrom, createFacilityForShipFrom, setChannelPlaceMode, setFacilityStockSource } from "@/app/facilities/actions";

export type PlaceMode = "auto" | "own" | "merged" | "mcf" | "ignored";

export type MappingData = {
  amazonManaged: { id: string; name: string; kind: "FBA" | "AWD" }[];
  fbaName: string | null;
  shipFrom: { id: string; key: string; label: string; facility: { id: string; name: string } | null; orders: number; active: boolean }[];
  channelPlaces: {
    id: string;
    channel: string;
    label: string; // the place as the platform names it
    active: boolean;
    mode: PlaceMode;
    autoMcf: boolean; // consl's own guess: this is Amazon's fulfilment
    facility: { id: string; name: string; channel: string | null } | null; // where it counts today
    ownFacilityId: string | null; // the facility the sync made for this very place, if any
    ownActive: boolean;
    mergedHere: string[]; // other platforms' places merged into this one's facility
    reportedUnits: number; // what the platform last reported here for the company's products
    reportedSkus: number;
    orders: number; // orders the platform says shipped from here
    stock: { facilityId: string; platforms: string[]; source: string } | null; // merged into another platform's facility
  }[];
  candidates: { id: string; name: string; code: string; type: string; channel: string | null }[];
};

const PLATFORM: Record<string, string> = { SHOPIFY: "Shopify", TIKTOK: "TikTok" };
const num = (x: number) => x.toLocaleString();
const plural = (x: number, one: string, many = `${one}s`) => (x === 1 ? one : many);

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

type Mode = "own" | "merged" | "mcf" | "ignored";
type Place = MappingData["channelPlaces"][number];
const btnDanger = "inline-flex h-8 items-center gap-1.5 rounded-lg bg-negative px-3 text-[12.5px] font-medium text-white hover:opacity-90 disabled:opacity-50";

/** "What is this place?" — four answers, each spelling out what it will do with the real numbers
 *  before anything happens. */
function PlaceDialog({ place, candidates, fbaName, onClose }: { place: Place; candidates: MappingData["candidates"]; fbaName: string | null; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const current: Mode = place.mode === "auto" ? (place.autoMcf ? "mcf" : "own") : place.mode;
  const [mode, setMode] = useState<Mode>(current);
  const [target, setTarget] = useState(place.mode === "merged" ? place.facility?.id ?? "" : "");
  const [source, setSource] = useState(""); // "" = the facility's own platform
  const [error, setError] = useState<string | null>(null);
  const noun = place.channel === "SHOPIFY" ? "location" : "warehouse";
  const platform = PLATFORM[place.channel] ?? place.channel;
  const options = candidates.filter((f) => f.id !== place.ownFacilityId);
  const targetF = options.find((f) => f.id === target) ?? null;
  const ownName = place.ownActive && place.mode !== "merged" ? place.facility?.name ?? place.label : place.label;
  const reported = place.reportedUnits > 0 ? `${num(place.reportedUnits)} ${plural(place.reportedUnits, "unit")} of ${place.reportedSkus} ${plural(place.reportedSkus, "product")} ${platform} reports here` : null;
  const orders = place.orders > 0 ? `${num(place.orders)} ${plural(place.orders, "order")} shipped from here` : null;
  const follows = place.mergedHere.length > 0 ? ` ${place.mergedHere.map((m) => `“${m}”`).join(", ")}, merged into it, ${place.mergedHere.length === 1 ? "follows" : "follow"} the same choice.` : "";
  const retires = place.ownActive ? `Its own facility “${ownName}” retires.${follows}` : null;
  const stockChoice = mode === "merged" && targetF && (targetF.channel === "SHOPIFY" || targetF.channel === "TIKTOK") && targetF.channel !== place.channel ? targetF : null;
  const defaultSource = stockChoice ? (stockChoice.id === place.facility?.id ? place.stock?.source ?? stockChoice.channel! : stockChoice.channel!) : "";
  const chosenSource = source || defaultSource;

  const lines: string[] = [];
  if (mode === "own") {
    if (!place.ownActive) lines.push(`consl tracks it as a facility of its own, “${place.label}”.`);
    if (orders) lines.push(`${orders} count at its own facility.`);
    if (reported) lines.push(`${reported} count as stock there.`);
    if (!orders && !reported && place.ownActive) lines.push("Nothing changes.");
  } else if (mode === "merged") {
    if (!targetF) lines.push("Pick the facility this place really is.");
    else {
      if (orders) lines.push(`${orders} count at ${targetF.name}.`);
      if (reported) lines.push(targetF.channel ? `${reported} count as stock at ${targetF.name}${stockChoice ? ` (counting ${PLATFORM[chosenSource] ?? chosenSource}'s number)` : ""}.` : `Stock at ${targetF.name} comes from your own records in consl, so the ${reported} are not counted on top.`);
      if (retires) lines.push(retires);
    }
  } else if (mode === "mcf") {
    if (orders) lines.push(`${orders} count as shipped from ${fbaName ?? "Amazon FBA"}.`);
    lines.push(reported ? `${reported} are not counted — they are already counted as your FBA stock.` : `Units ${platform} reports here are not counted — they are already counted as your FBA stock.`);
    if (retires) lines.push(retires);
  } else {
    lines.push("Removed from Facilities.");
    if (orders) lines.push(`${orders} will show as “no facility”. Their sales still count; their cost of goods uses your average cost.`);
    lines.push(reported ? `${reported} are not counted anywhere in consl.` : `Whatever ${platform} reports here is not counted anywhere in consl.`);
    if (retires) lines.push(retires);
  }
  const unchanged = mode === current && (mode !== "merged" || (target === (place.facility?.id ?? "") && (!stockChoice || chosenSource === (place.stock?.source ?? stockChoice.channel))));
  const label =
    mode === "own" ? (current === "own" ? "Keep as its own facility" : "Make it its own facility")
    : mode === "merged" ? `Merge into ${targetF?.name ?? "…"}`
    : mode === "mcf" ? "Mark as Amazon MCF"
    : `Ignore this ${noun}`;
  const save = () =>
    start(async () => {
      const r = await setChannelPlaceMode(place.id, { mode, targetFacilityId: mode === "merged" ? target || null : null, ...(stockChoice ? { stockSource: chosenSource } : {}) });
      if (!r.ok) return setError(r.error ?? "Something went wrong.");
      router.refresh();
      onClose();
    });
  const choices: { value: Mode; title: string; hint: string; disabled?: boolean }[] = [
    { value: "own", title: "Its own facility", hint: `consl tracks this ${noun} as a facility of its own — what happens automatically.` },
    { value: "merged", title: "Same place as another facility", hint: "One warehouse that another platform, or you, already track as a facility. Its orders and its stock count there." },
    { value: "mcf", title: "Amazon MCF", hint: fbaName ? "Amazon ships these orders from FBA. They count there, and the units reported here are ignored: they are already your FBA stock." : "Connect Amazon first.", disabled: !fbaName },
    { value: "ignored", title: `Ignore this ${noun}`, hint: "Not a place consl should track. Gone from Facilities, its orders have no facility, its units are not counted." },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`What is ${place.label}?`}
        className="org-pop max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold text-ink">What is “{place.label}”?</div>
            <div className="text-[12px] text-muted">{platform} {noun}</div>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="mt-4 space-y-2">
          {choices.map((c) => {
            const selected = mode === c.value;
            return (
              <div key={c.value} className={`rounded-lg border ${selected ? "border-accent-strong bg-accent-soft/30" : "border-border"} ${c.disabled ? "opacity-50" : ""}`}>
                <button type="button" disabled={c.disabled} onClick={() => setMode(c.value)} className="flex w-full items-start gap-3 px-3 py-2.5 text-left disabled:cursor-not-allowed">
                  <span className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border ${selected ? "border-[5px] border-accent-strong" : "border-border bg-surface"}`} />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-ink">{c.title}</span>
                    <span className="block text-[12px] leading-relaxed text-muted">{c.hint}</span>
                  </span>
                </button>
                {selected && c.value === "merged" && (
                  <div className="border-t border-border px-3 py-2.5">
                    <div className="max-w-[300px]">
                      <SelectMenu value={target} onChange={setTarget} options={[{ value: "", label: "Pick a facility" }, ...options.map((f) => ({ value: f.id, label: f.name, hint: f.code }))]} />
                    </div>
                    {stockChoice && (
                      <div className="mt-2.5 text-[12px] text-ink-soft">
                        <div>Both {PLATFORM[stockChoice.channel!]} and {platform} report stock at this place. Count it from</div>
                        <div className="mt-1.5 flex flex-wrap gap-2">
                          {[stockChoice.channel!, place.channel].map((pf) => (
                            <button
                              key={pf}
                              type="button"
                              onClick={() => setSource(pf)}
                              className={`rounded-md border px-2.5 py-1 text-[12px] font-medium ${chosenSource === pf ? "border-accent-strong bg-accent-strong text-white" : "border-border bg-surface text-ink-soft hover:text-ink"}`}
                            >
                              {PLATFORM[pf] ?? pf}
                              {pf === stockChoice.channel && <span className="ml-1 font-normal opacity-80">(default)</span>}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-4 rounded-lg border border-border bg-surface-2/40 px-3 py-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">What happens</div>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-[12.5px] leading-relaxed text-ink-soft">
            {lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
          <div className="mt-1.5 text-[11.5px] text-muted">You can change your mind any time from this same dialog.</div>
        </div>
        {error && <p className="mt-2 text-[12px] text-negative">{error}</p>}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="button" className={mode === "ignored" ? btnDanger : btnPrimary} onClick={save} disabled={pending || unchanged || (mode === "merged" && !target)}>
            {pending ? "Working…" : label}
          </button>
        </div>
      </div>
    </div>
  );
}

/** "Use TikTok's count instead" on a merged row: the other platform's number becomes the count. */
function SourceSwitch({ stock, from }: { stock: NonNullable<Place["stock"]>; from: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const other = stock.platforms.find((p) => p !== stock.source) ?? from;
  return (
    <>
      <button
        type="button"
        disabled={pending}
        className="text-accent underline-offset-2 hover:underline disabled:opacity-50"
        onClick={() =>
          start(async () => {
            const r = await setFacilityStockSource(stock.facilityId, other);
            if (!r.ok) return setError(r.error ?? "Something went wrong.");
            setError(null);
            router.refresh();
          })
        }
      >
        {pending ? "Switching…" : `Use ${PLATFORM[other] ?? other}'s count instead`}
      </button>
      {error && <span className="text-negative"> {error}</span>}
    </>
  );
}

/** One Shopify location or TikTok warehouse: what consl does with it, and one button to change it. */
function ChannelPlaceRow({ place, candidates, fbaName }: { place: Place; candidates: MappingData["candidates"]; fbaName: string | null }) {
  const [open, setOpen] = useState(false);
  const platform = PLATFORM[place.channel] ?? place.channel;
  const noun = place.channel === "SHOPIFY" ? "location" : "warehouse";
  const isMcf = place.mode === "mcf" || place.autoMcf;
  const reported = place.reportedUnits > 0 ? `${num(place.reportedUnits)} ${plural(place.reportedUnits, "unit")} of ${place.reportedSkus} ${plural(place.reportedSkus, "product")} reported here` : "nothing reported here";
  let title: string;
  let sub: React.ReactNode = null;
  if (place.mode === "ignored") {
    title = "Ignored";
    sub = `Not counted · ${reported}`;
  } else if (isMcf) {
    title = "Amazon MCF";
    sub = `Orders count as ${fbaName ?? "Amazon FBA"} · units reported here are FBA stock, not counted again`;
  } else if (place.mode === "merged" && place.facility) {
    title = `Merged into ${place.facility.name}`;
    sub = place.stock ? (
      <>
        Counting {PLATFORM[place.stock.source] ?? place.stock.source}&apos;s stock · <SourceSwitch stock={place.stock} from={place.channel} />
      </>
    ) : place.facility.channel ? null : "Stock comes from your own records in consl";
  } else if (place.facility) {
    title = `Its own facility · ${place.facility.name}`;
  } else {
    title = "Not synced yet";
    sub = "consl hasn't read this place from the platform yet.";
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 text-[13px]">
      <div className="min-w-0">
        <div className="truncate font-medium text-ink">{place.label}</div>
        <div className="text-[11.5px] text-muted">
          {platform} {noun}
          {!place.active && " · inactive on the platform"}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="text-right">
          <div className="flex flex-wrap items-center justify-end gap-2 text-ink-soft">
            <span>{title}</span>
            {place.mode === "auto" ? <span className={`${PILL} pill-green`}>Automatic</span> : <span className={`${PILL} pill-chart`}>Set by you</span>}
          </div>
          {sub && <div className="text-[11.5px] text-muted">{sub}</div>}
        </div>
        <button type="button" className={btnSecondary} onClick={() => setOpen(true)}>
          Change
        </button>
      </div>
      {open && <PlaceDialog place={place} candidates={candidates} fbaName={fbaName} onClose={() => setOpen(false)} />}
    </div>
  );
}

export function FacilityMappingClient({ data }: { data: MappingData }) {
  const shopify = data.channelPlaces.filter((p) => p.channel === "SHOPIFY");
  const tiktok = data.channelPlaces.filter((p) => p.channel === "TIKTOK");
  const managed = <span className={`${PILL} pill-neutral`}><Lock size={11} /> Managed</span>;

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
        <Section channel="SHOPIFY" title="Shopify" hint="Each location becomes a facility on its own. Change it if a location is really another facility, Amazon's fulfilment, or nothing consl should track.">
          {shopify.map((p) => (
            <ChannelPlaceRow key={p.id} place={p} candidates={data.candidates} fbaName={data.fbaName} />
          ))}
        </Section>
      )}
      {tiktok.length > 0 && (
        <Section channel="TIKTOK" title="TikTok Shop" hint="Each warehouse becomes a facility on its own. Change it if a warehouse is really another facility, Amazon's fulfilment, or nothing consl should track.">
          {tiktok.map((p) => (
            <ChannelPlaceRow key={p.id} place={p} candidates={data.candidates} fbaName={data.fbaName} />
          ))}
        </Section>
      )}
      {data.amazonManaged.length === 0 && data.shipFrom.length === 0 && shopify.length === 0 && tiktok.length === 0 && (
        <p className="text-[13px] text-muted">Connect a sales channel and its places will appear here.</p>
      )}
    </div>
  );
}
