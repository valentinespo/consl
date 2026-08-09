"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RefreshCw, Undo2, ArrowLeftRight, CheckCircle2 } from "@/components/icons";
import { refreshChannelListings, applyChannelMappings, type MappingActionItem } from "@/app/catalog/actions";
import { useCan } from "@/components/AccessProvider";

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

type PickerProduct = { id: string; code: string; name: string; takenExternalId: string | null };

type Stage = { action: "map"; productId: string } | { action: "import" } | { action: "ignore" } | { action: "unmap" } | { action: "restore" } | null;

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
}: {
  channel: "SHOPIFY" | "AMAZON";
  tabs: Array<{ key: string; title: string; logo: string }>;
  rows: Row[];
  products: PickerProduct[];
  justConnected: boolean;
}) {
  const router = useRouter();
  const canEdit = useCan("catalog", "create");
  const [pendingSave, setPendingSave] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const pendingRows = rows.filter((r) => !r.mapped && !r.ignored);
  const mappedRows = rows.filter((r) => r.mapped);
  const ignoredRows = rows.filter((r) => !r.mapped && r.ignored);

  const [stages, setStages] = useState<Record<string, Stage>>(() => {
    const init: Record<string, Stage> = {};
    for (const r of pendingRows) if (r.suggestion) init[r.id] = { action: "map", productId: r.suggestion.productId };
    return init;
  });

  const stagedCount = useMemo(() => Object.values(stages).filter(Boolean).length, [stages]);

  const setStage = (id: string, s: Stage) => setStages((prev) => ({ ...prev, [id]: s }));

  async function save() {
    const items: MappingActionItem[] = [];
    for (const [listingId, s] of Object.entries(stages)) {
      if (!s) continue;
      if (s.action === "map") items.push({ listingId, action: "map", productId: s.productId });
      else items.push({ listingId, action: s.action });
    }
    if (!items.length) return;
    setPendingSave(true);
    setNote(null);
    try {
      const r = await applyChannelMappings(channel, items);
      if (!r.ok) {
        setNote("Save failed — try again.");
        return;
      }
      setNote(
        r.failed.length
          ? `${r.applied} saved, ${r.failed.length} failed: ${r.failed[0]?.error ?? ""}`
          : `${r.applied} change${r.applied === 1 ? "" : "s"} saved.`,
      );
      setStages({});
      router.refresh();
    } catch {
      setNote("Couldn't reach the server — reload and retry.");
    } finally {
      setPendingSave(false);
    }
  }

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
              href={`/catalog/mapping?channel=${t.key}`}
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
          {note && <span className="text-[12px] text-ink-soft">{note}</span>}
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
          {canEdit && (
            <button
              onClick={save}
              disabled={pendingSave || stagedCount === 0}
              className="rounded-lg bg-ink px-3.5 py-1.5 text-[12.5px] font-medium text-bg hover:opacity-90 disabled:opacity-40"
            >
              {pendingSave ? "Saving…" : `Save changes${stagedCount ? ` (${stagedCount})` : ""}`}
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

      {/* Needs review */}
      <section>
        <h2 className="mb-2 text-[13px] font-medium text-ink">
          Needs review <span className="text-ink-soft">· {pendingRows.length}</span>
        </h2>
        {pendingRows.length === 0 ? (
          <div className="rounded-xl border border-border bg-panel px-4 py-6 text-center text-[13px] text-ink-soft">
            Nothing to review — every listing is mapped or ignored.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-panel">
            {pendingRows.map((r, i) => {
              const stage = stages[r.id] ?? null;
              const mode = stage?.action ?? "skip";
              return (
                <div key={r.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${i > 0 ? "border-t border-border" : ""}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {r.imageUrl ? (
                    <img src={r.imageUrl} alt="" className="h-9 w-9 rounded-lg border border-border object-cover" />
                  ) : (
                    <span className="grid h-9 w-9 place-items-center rounded-lg border border-border text-ink-soft">
                      <ArrowLeftRight size={14} />
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
                  <div className="inline-flex items-center gap-2">
                    <select
                      value={mode}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "map") {
                          const first = r.suggestion?.productId ?? freeProducts()[0]?.id;
                          setStage(r.id, first ? { action: "map", productId: first } : null);
                        } else if (v === "import") setStage(r.id, { action: "import" });
                        else if (v === "ignore") setStage(r.id, { action: "ignore" });
                        else setStage(r.id, null);
                      }}
                      className="rounded-lg border border-border bg-panel px-2 py-1.5 text-[12.5px] text-ink"
                      disabled={!canEdit}
                    >
                      <option value="skip">Decide later</option>
                      <option value="map">Map to existing</option>
                      <option value="import">Import as new product</option>
                      <option value="ignore">Ignore</option>
                    </select>
                    {stage?.action === "map" && (
                      <select
                        value={stage.productId}
                        onChange={(e) => setStage(r.id, { action: "map", productId: e.target.value })}
                        className="max-w-[220px] rounded-lg border border-border bg-panel px-2 py-1.5 text-[12.5px] text-ink"
                        disabled={!canEdit}
                      >
                        {freeProducts(stage.productId).map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.code} — {p.name}
                          </option>
                        ))}
                      </select>
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
                    <span className="grid h-9 w-9 place-items-center rounded-lg border border-border text-ink-soft">
                      <ArrowLeftRight size={14} />
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

      {/* Ignored */}
      {ignoredRows.length > 0 && (
        <section>
          <h2 className="mb-2 text-[13px] font-medium text-ink">
            Ignored <span className="text-ink-soft">· {ignoredRows.length}</span>
          </h2>
          <div className="overflow-hidden rounded-xl border border-border bg-panel">
            {ignoredRows.map((r, i) => {
              const staged = stages[r.id]?.action === "restore";
              return (
                <div key={r.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${i > 0 ? "border-t border-border" : ""}`}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] text-ink-soft">{r.title}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11.5px] text-ink-soft">
                      {r.sku && <span className={`pill-neutral ${PILL}`}>{r.sku}</span>}
                      {staged && <span className={`pill-chart ${PILL}`}>Will restore on save</span>}
                    </div>
                  </div>
                  {canEdit && (
                    <button
                      onClick={() => setStage(r.id, staged ? null : { action: "restore" })}
                      className="rounded-lg border border-border bg-panel px-2.5 py-1.5 text-[12px] font-medium text-ink hover:bg-panel-2"
                    >
                      {staged ? "Keep ignored" : "Restore"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
