"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RefreshCw, Undo2, CameraOff, CheckCircle2 } from "@/components/icons";
import { refreshChannelListings, applyChannelMappings, type MappingActionItem } from "@/app/catalog/actions";
import { useCan } from "@/components/AccessProvider";
import { SelectMenu } from "@/components/SelectMenu";
import { SkuAvatar } from "@/components/ui";

type Row = {
  id: string;
  title: string;
  sku: string | null;
  imageUrl: string | null;
  price: number | null;
  ignored: boolean;
  mapped: { id: string; code: string; name: string; imageUrl: string | null } | null;
  suggestion: { productId: string; confidence: "exact" | "similar" } | null;
};

type PickerProduct = { id: string; code: string; name: string; imageUrl: string | null; takenExternalId: string | null };

type Stage = { action: "map"; productId: string } | { action: "import" } | { action: "ignore" } | { action: "unmap" } | null;

// The app-wide pill shape — the .pill-* classes only supply the frosted colors.
const PILL = "inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-medium";

/** The mapping worklist for one channel: suggestions arrive pre-selected, every row can be
 *  flipped to map / import / ignore, and nothing commits until Save. */
export function ChannelMappingClient({
  channel,
  tabs,
  rows,
  products,
  justConnected,
  hrefBase = "/catalog/mapping",
  hideSave = false,
  onStagesChange,
}: {
  channel: "SHOPIFY" | "AMAZON" | "TIKTOK";
  tabs: Array<{ key: string; title: string; logo: string }>;
  rows: Row[];
  products: PickerProduct[];
  justConnected: boolean;
  /** Where the channel tabs link to — the onboarding wizard embeds this screen on its own page. */
  hrefBase?: string;
  /** The wizard saves through its floating bar instead of the footer button. */
  hideSave?: boolean;
  /** Reports staged-decision state upward (null = clean) so the wizard bar can save/discard it. */
  onStagesChange?: (s: { save: () => Promise<string | null>; discard: () => void } | null) => void;
}) {
  const router = useRouter();
  const canEdit = useCan("catalog", "create");
  const [pendingSave, setPendingSave] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // One merged worklist: everything not mapped, whether it's still pending or already ignored.
  // "Ignore" is the default treatment — leaving a row alone and ignoring it are the same thing.
  const unmappedRows = rows.filter((r) => !r.mapped);
  const mappedRows = rows.filter((r) => r.mapped);

  const [stages, setStages] = useState<Record<string, Stage>>(() => {
    const init: Record<string, Stage> = {};
    for (const r of unmappedRows) if (!r.ignored && r.suggestion) init[r.id] = { action: "map", productId: r.suggestion.productId };
    return init;
  });

  const stagedCount = useMemo(() => Object.values(stages).filter(Boolean).length, [stages]);

  const setStage = (id: string, s: Stage) => setStages((prev) => ({ ...prev, [id]: s }));

  // Batch selection over the unmapped list — one bulk decision for many rows at once.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = unmappedRows.length > 0 && unmappedRows.every((r) => selected.has(r.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(unmappedRows.map((r) => r.id)));
  /** The one bulk action: stage "Import as new product" for everything selected (Ignore is the
   *  default state of every row, so it needs no bulk button). */
  const applyBulk = (action: "import") => {
    setStages((prev) => {
      const next = { ...prev };
      for (const id of selected) next[id] = { action };
      return next;
    });
    setSelected(new Set());
  };

  /** Commit the staged decisions. Returns an error string (null on success) so the wizard's
   *  floating bar can surface failures; the standalone footer button shows them as a note. */
  async function doSave(): Promise<string | null> {
    const items: MappingActionItem[] = [];
    for (const [listingId, s] of Object.entries(stages)) {
      if (!s) continue;
      if (s.action === "map") items.push({ listingId, action: "map", productId: s.productId });
      else items.push({ listingId, action: s.action });
    }
    if (!items.length) return null;
    setPendingSave(true);
    setNote(null);
    try {
      const r = await applyChannelMappings(channel, items);
      if (!r.ok) return "Save failed — try again.";
      setNote(
        r.failed.length
          ? `${r.applied} saved, ${r.failed.length} failed: ${r.failed[0]?.error ?? ""}`
          : `${r.applied} change${r.applied === 1 ? "" : "s"} saved.`,
      );
      setStages({});
      router.refresh();
      return r.failed.length ? `${r.failed.length} of the changes failed: ${r.failed[0]?.error ?? ""}` : null;
    } catch {
      return "Couldn't reach the server — reload and retry.";
    } finally {
      setPendingSave(false);
    }
  }

  async function save() {
    const err = await doSave();
    if (err) setNote(err);
  }

  // Tell the wizard whether decisions are staged here, with fresh save/discard closures.
  useEffect(() => {
    if (!onStagesChange) return;
    onStagesChange(stagedCount > 0 ? { save: doSave, discard: () => setStages({}) } : null);
    return () => onStagesChange(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-register per stages change only
  }, [stages]);

  async function refresh() {
    setRefreshing(true);
    setNote(null);
    try {
      const r = await refreshChannelListings(channel);
      setNote(r.ok ? `Pulled ${r.seen} listings${r.autoMapped ? `, auto-mapped ${r.autoMapped}` : ""}.` : (r.error ?? "Refresh failed"));
      if (r.ok) router.refresh();
    } catch {
      setNote("Couldn't reach the server — reload and retry.");
    } finally {
      setRefreshing(false);
    }
  }

  const freeProducts = (current?: string) =>
    products.filter((p) => !p.takenExternalId || p.id === current);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 rounded-xl border border-border bg-panel p-1">
          {tabs.map((t) => (
            <Link
              key={t.key}
              href={`${hrefBase}?channel=${t.key}`}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-[12.5px] font-medium ${
                t.key === channel ? "bg-ink text-bg" : "text-ink-soft hover:text-ink"
              }`}
            >
              <span className="grid h-5 w-5 place-items-center rounded bg-white p-0.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={t.logo} alt="" className="max-h-full max-w-full object-contain" />
              </span>
              {t.title}
            </Link>
          ))}
        </div>
        <div className="inline-flex items-center gap-2">
          {canEdit && (
            <button
              onClick={refresh}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-panel px-3 py-1.5 text-[12.5px] font-medium text-ink hover:bg-panel-2 disabled:opacity-40"
            >
              <RefreshCw size={13} className={refreshing ? "animate-spin" : undefined} />
              {refreshing ? "Refreshing…" : "Refresh listings"}
            </button>
          )}
        </div>
      </div>

      {justConnected && (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-panel px-4 py-3 text-[13px] text-ink">
          <CheckCircle2 size={15} className="text-accent" />
          Channel connected. Review the matches below — exact matches were mapped automatically, suggestions are pre-selected for you to
          confirm or change.
        </div>
      )}

      {/* Unmapped — pending and ignored merged; leaving a row on "Ignore" IS the decision. */}
      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2.5 text-[13px] font-medium text-ink">
            {canEdit && unmappedRows.length > 0 && (
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                aria-label="Select every listing below"
                className="accent-[var(--color-accent)]"
              />
            )}
            Unmapped <span className="text-ink-soft">· {unmappedRows.length}</span>
          </h2>
          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
              <span className="mr-1 text-ink-soft">{selected.size} selected —</span>
              <button
                onClick={() => applyBulk("import")}
                className="rounded-lg border border-border bg-panel px-2.5 py-1 font-medium text-ink hover:bg-panel-2"
              >
                Import as new product
              </button>
            </div>
          )}
        </div>
        {unmappedRows.length === 0 ? (
          <div className="rounded-xl border border-border bg-panel px-4 py-6 text-center text-[13px] text-ink-soft">
            Nothing here — every listing is mapped.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-panel">
            {unmappedRows.map((r, i) => {
              const stage = stages[r.id] ?? null;
              const mode = stage?.action ?? "ignore";
              const canMap = freeProducts(stage?.action === "map" ? stage.productId : undefined).length > 0;
              return (
                <div key={r.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${i > 0 ? "border-t border-border" : ""}`}>
                  {canEdit && (
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={() => toggleSelected(r.id)}
                      aria-label={`Select ${r.title}`}
                      className="accent-[var(--color-accent)]"
                    />
                  )}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {r.imageUrl ? (
                    <img src={r.imageUrl} alt="" className="h-9 w-9 rounded-lg border border-border object-cover" />
                  ) : (
                    <span title="No picture on the channel" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border bg-surface-2/60 text-muted">
                      <CameraOff size={15} />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-ink">{r.title}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11.5px] text-ink-soft">
                      {r.sku ? <span className={`pill-neutral ${PILL}`}>{r.sku}</span> : <span className="italic">no SKU</span>}
                      {r.price != null && <span>${r.price.toFixed(2)}</span>}
                      {r.suggestion && stage?.action === "map" && (
                        <span className={`pill-chart ${PILL}`}>{r.suggestion.confidence === "exact" ? "Exact match" : "Suggested"}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <SelectMenu
                      value={mode}
                      disabled={!canEdit}
                      ariaLabel={`Decision for ${r.title}`}
                      className="w-[190px]"
                      options={[
                        { value: "ignore", label: "Ignore" },
                        // Nothing to map to until at least one consl product exists and is free.
                        ...(canMap ? [{ value: "map", label: "Map to existing" }] : []),
                        { value: "import", label: "Import as new product" },
                      ]}
                      onChange={(v) => {
                        if (v === "map") {
                          const first = r.suggestion?.productId ?? freeProducts()[0]?.id;
                          setStage(r.id, first ? { action: "map", productId: first } : null);
                        } else if (v === "import") setStage(r.id, { action: "import" });
                        // "Ignore": for a pending row that's a real decision to save; an already-
                        // ignored row just returns to its resting state.
                        else setStage(r.id, r.ignored ? null : { action: "ignore" });
                      }}
                    />
                    {stage?.action === "map" && (
                      <SelectMenu
                        value={stage.productId}
                        disabled={!canEdit}
                        ariaLabel="Product to map to"
                        className="w-[160px]"
                        options={freeProducts(stage.productId).map((p) => ({
                          // Code up front, full name as the muted second line — long titles
                          // truncate in the panel instead of stretching the trigger.
                          value: p.id,
                          label: p.code,
                          hint: p.name,
                          icon: <SkuAvatar code={p.code} size={20} imageUrl={p.imageUrl} />,
                        }))}
                        onChange={(v) => setStage(r.id, { action: "map", productId: v })}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Mapped */}
      <section>
        <h2 className="mb-2 text-[13px] font-medium text-ink">
          Mapped <span className="text-ink-soft">· {mappedRows.length}</span>
        </h2>
        {mappedRows.length === 0 ? (
          <div className="rounded-xl border border-border bg-panel px-4 py-5 text-center text-[13px] text-ink-soft">Nothing mapped yet.</div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-panel">
            {mappedRows.map((r, i) => {
              const staged = stages[r.id]?.action === "unmap";
              return (
                <div key={r.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${i > 0 ? "border-t border-border" : ""}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {(r.mapped?.imageUrl ?? r.imageUrl) ? (
                    <img src={r.mapped?.imageUrl ?? r.imageUrl ?? ""} alt="" className="h-9 w-9 rounded-lg border border-border object-cover" />
                  ) : (
                    <span title="No picture on the channel" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border bg-surface-2/60 text-muted">
                      <CameraOff size={15} />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] text-ink">
                      <span className="font-medium">{r.title}</span>
                      <span className="mx-2 text-ink-soft">→</span>
                      <span className="font-medium">{r.mapped!.code}</span>
                      <span className="text-ink-soft"> · {r.mapped!.name}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11.5px] text-ink-soft">
                      {r.sku && <span className={`pill-neutral ${PILL}`}>{r.sku}</span>}
                      {staged ? <span className={`pill-amber ${PILL}`}>Will unmap on save</span> : <span className={`pill-green ${PILL}`}>Mapped</span>}
                    </div>
                  </div>
                  {canEdit && (
                    <button
                      onClick={() => setStage(r.id, staged ? null : { action: "unmap" })}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-panel px-2.5 py-1.5 text-[12px] font-medium text-ink hover:bg-panel-2"
                    >
                      {staged ? (
                        <>
                          <Undo2 size={12} /> Keep mapping
                        </>
                      ) : (
                        "Unmap"
                      )}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Commit bar — decisions stage above, the save lives at the container's foot. The wizard
          hides it and saves through its own floating bar instead. */}
      {canEdit && !hideSave && (
        <div className="flex items-center justify-end gap-3">
          {note && <span className="text-[12px] text-ink-soft">{note}</span>}
          <button
            onClick={save}
            disabled={pendingSave || stagedCount === 0}
            className="rounded-lg bg-ink px-3.5 py-1.5 text-[12.5px] font-medium text-bg hover:opacity-90 disabled:opacity-40"
          >
            {pendingSave ? "Saving…" : `Save changes${stagedCount ? ` (${stagedCount})` : ""}`}
          </button>
        </div>
      )}
    </div>
  );
}
