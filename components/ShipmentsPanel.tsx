"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SkuAvatar } from "@/components/ui";
import { CaretDown } from "@/components/icons";
import { Field, inputCls } from "@/components/FormKit";
import { recordShipmentHandoff, setShipmentIgnored, reverseCancelledShipment } from "@/app/facilities/shipment-actions";

type ShipmentRow = {
  id: string;
  channel: string;
  externalId: string;
  name: string | null;
  extStatus: string;
  destination: string | null;
  origin: string;
  historical: boolean;
  ignored: boolean;
  dead: boolean;
  effDateISO: string;
  linkedQty: number;
  hasLinks: boolean;
  recorded: boolean;
  lines: { sellerSku: string; productId: string | null; code: string | null; imageUrl: string | null; qtyShipped: number; qtyReceived: number | null; linked: number; unmapped: boolean }[];
};

type FacilityOpt = { id: string; code: string; name: string };
type OpenLot = { id: string; poNumber: string | null; productIds: string[]; units: number };

const STATUS_PILL = (s: string, dead: boolean) =>
  dead ? "pill-red" : s === "CLOSED" ? "pill-green" : s === "RECEIVING" || s === "DELIVERED" ? "pill-chart" : "pill-amber";

/** The org's real platform shipments (FBA/AWD). Live first; historical collapsed. With edit
 *  access, each live unrecorded shipment opens the handoff card: pick the source facility,
 *  optionally finish the producing lots (+ bundled estimate), and the ledger gets real linked
 *  movements — capped at what the facility physically holds; the rest stays virtual. */
export function ShipmentsPanel({
  shipments,
  facilities = [],
  openLots = [],
  canEdit = false,
  awaitingSkus = [],
}: {
  shipments: ShipmentRow[];
  facilities?: FacilityOpt[];
  openLots?: OpenLot[];
  canEdit?: boolean;
  /** productIds the handoff layer still counts virtually — only their shipments need recording.
   *  A live shipment already covered by unlinked hand-records must NOT invite a second entry. */
  awaitingSkus?: string[];
}) {
  const router = useRouter();
  const [showHistorical, setShowHistorical] = useState(false);
  const [cardFor, setCardFor] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const live = shipments.filter((s) => !s.historical && !s.ignored);
  const rest = shipments.filter((s) => s.historical || s.ignored);

  const act = async (id: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(id);
    setNotice(null);
    try {
      const res = await fn();
      if (!res.ok) setNotice(res.error ?? "Something went wrong.");
      else router.refresh();
    } catch {
      setNotice("Couldn't reach the server — reload to check.");
    } finally {
      setBusy(null);
    }
  };

  const Row = ({ s }: { s: ShipmentRow }) => {
    // Anything on this shipment still counted virtually? If not, it's covered — either by links
    // or by hand-recorded (unlinked) movements the netting already credits.
    const needsAction = !s.dead && !s.historical && !s.ignored && !s.recorded && s.lines.some((l) => l.productId && awaitingSkus.includes(l.productId));
    const covered = !s.dead && !s.historical && !s.ignored && !s.recorded && !needsAction;
    return (
    <div className="border-b border-line last:border-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
        <span className="inline-flex items-center rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-[10.5px] font-medium text-ink-soft">
          {s.channel}
        </span>
        <span className="min-w-0 truncate text-[12.5px] font-medium text-ink" title={s.externalId}>
          {s.name ?? s.externalId}
        </span>
        <span className={`${STATUS_PILL(s.extStatus, s.dead)} inline-flex items-center rounded-full px-2 py-[3px] text-[10.5px] font-medium leading-none`}>
          {s.extStatus.toLowerCase()}
        </span>
        {s.recorded && (
          <span className="pill-green inline-flex items-center rounded-full px-2 py-[3px] text-[10.5px] font-medium leading-none" title="Every unit is covered by a recorded, linked movement">
            recorded
          </span>
        )}
        {covered && (
          <span className="pill-neutral inline-flex items-center rounded-full px-2 py-[3px] text-[10.5px] font-medium leading-none" title="These units are already accounted for by recorded stock movements — nothing counts twice">
            covered
          </span>
        )}
        {s.ignored && (
          <span className="pill-neutral inline-flex items-center rounded-full px-2 py-[3px] text-[10.5px] font-medium leading-none" title={s.origin === "AMAZON" ? "Amazon-internal shipment (e.g. AWD→FBA replenishment) — excluded from reconciliation" : "Excluded from reconciliation"}>
            {s.origin === "AMAZON" ? "amazon-internal" : "ignored"}
          </span>
        )}
        <span className="text-[11px] text-muted">{s.effDateISO}{s.destination ? ` · ${s.destination}` : ""}</span>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {s.lines.map((l) => {
            // A CLOSED shipment with a receiving gap is final — Amazon lost or found units.
            // Informational only (never an automatic LOSS movement): shorts are reimbursement
            // candidates, overs are free stock; both deserve a look, not a write.
            const diff = s.extStatus.toUpperCase() === "CLOSED" && l.qtyReceived != null ? l.qtyReceived - l.qtyShipped : 0;
            return (
            <span key={l.sellerSku} className="inline-flex items-center gap-1.5 text-[11.5px] text-ink-soft" title={l.sellerSku}>
              {l.code ? <SkuAvatar code={l.code} size={18} imageUrl={l.imageUrl} /> : null}
              <span className={l.unmapped ? "text-negative" : ""}>{l.code ?? `${l.sellerSku} (unmapped)`}</span>
              <span className="tabular text-muted">
                {l.qtyShipped}
                {l.qtyReceived != null && l.qtyReceived !== l.qtyShipped ? ` → ${l.qtyReceived}` : ""}
              </span>
              {diff < 0 && (
                <span className="pill-amber inline-flex items-center rounded-full px-1.5 py-[2px] text-[10px] font-medium leading-none" title={`Amazon closed this shipment having received ${-diff} fewer than shipped — worth a reimbursement check`}>
                  {diff} short
                </span>
              )}
              {diff > 0 && (
                <span className="pill-neutral inline-flex items-center rounded-full px-1.5 py-[2px] text-[10px] font-medium leading-none" title={`Amazon received ${diff} more than the shipment declared`}>
                  +{diff} over
                </span>
              )}
            </span>
            );
          })}
          {canEdit && needsAction && (
            <button
              type="button"
              onClick={() => setCardFor(cardFor === s.id ? null : s.id)}
              className="rounded-lg border border-accent-strong bg-accent-soft px-2.5 py-1 text-[11.5px] font-medium text-accent hover:opacity-85"
            >
              {cardFor === s.id ? "Close" : "Record"}
            </button>
          )}
          {canEdit && (needsAction || (s.ignored && !s.historical && s.origin !== "AMAZON")) && (
            <button
              type="button"
              disabled={busy === s.id}
              onClick={() => act(s.id, () => setShipmentIgnored(s.id, !s.ignored))}
              className="rounded-lg border border-border px-2.5 py-1 text-[11.5px] text-muted hover:bg-surface-2 disabled:opacity-40"
            >
              {s.ignored ? "Include" : "Ignore"}
            </button>
          )}
          {canEdit && s.dead && s.hasLinks && (
            <button
              type="button"
              disabled={busy === s.id}
              onClick={() => act(s.id, () => reverseCancelledShipment(s.id))}
              className="rounded-lg border border-[#f0d3cb] bg-[#fdf2ef] px-2.5 py-1 text-[11.5px] font-medium text-negative hover:opacity-85 disabled:opacity-40"
            >
              Reverse
            </button>
          )}
        </span>
      </div>
      {cardFor === s.id && (
        <HandoffCard
          shipment={s}
          facilities={facilities}
          openLots={openLots}
          onDone={(msg) => {
            setCardFor(null);
            if (msg) setNotice(msg);
            router.refresh();
          }}
        />
      )}
    </div>
    );
  };

  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-surface">
      {notice && <div className="border-b border-line px-3 py-2 text-[12px] text-ink-soft">{notice}</div>}
      {live.length === 0 && <div className="px-3 py-3 text-[12.5px] text-muted">No open platform shipments right now.</div>}
      {live.map((s) => (
        <Row key={s.id} s={s} />
      ))}
      {rest.length > 0 && (
        <button
          type="button"
          onClick={() => setShowHistorical((v) => !v)}
          className="flex w-full items-center gap-1.5 border-t border-line px-3 py-2 text-left text-[12px] font-medium text-muted hover:text-ink-soft"
        >
          <CaretDown size={13} className={`transition-transform ${showHistorical ? "rotate-180" : ""}`} />
          {rest.length} historical / internal shipments
        </button>
      )}
      {showHistorical && rest.map((s) => <Row key={s.id} s={s} />)}
    </div>
  );
}

/** The batch-18 card: where did these units leave from, which lots produced them, expected cost. */
function HandoffCard({
  shipment,
  facilities,
  openLots,
  onDone,
}: {
  shipment: ShipmentRow;
  facilities: FacilityOpt[];
  openLots: OpenLot[];
  onDone: (msg: string | null) => void;
}) {
  const [facilityId, setFacilityId] = useState(facilities[0]?.id ?? "");
  const [finishIds, setFinishIds] = useState<string[]>([]);
  const [estimate, setEstimate] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const skuIds = new Set(shipment.lines.filter((l) => !l.unmapped).map((l) => l.productId!));
  const matchingLots = openLots.filter((l) => l.productIds.some((p) => skuIds.has(p)));
  const remainder = shipment.lines.filter((l) => !l.unmapped).reduce((s, l) => s + Math.max(0, l.qtyShipped - l.linked), 0);

  async function confirm() {
    setError(null);
    setPending(true);
    try {
      const res = await recordShipmentHandoff({
        shipmentId: shipment.id,
        facilityId,
        alsoFinishLotIds: finishIds,
        estimateAmount: Number(estimate) || null,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const bits = [`Recorded ${Math.round(res.written).toLocaleString()} units`];
      if (res.finishedLots > 0) bits.push(`finished ${res.finishedLots} lot${res.finishedLots > 1 ? "s" : ""}`);
      if (res.leftVirtual > 0) bits.push(`${Math.round(res.leftVirtual).toLocaleString()} left virtual (not enough at that location yet)`);
      onDone(bits.join(" · ") + (res.warning ? ` — ${res.warning}` : ""));
    } catch {
      setError("Couldn't reach the server — reload to check whether it recorded.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="border-t border-line bg-surface-2/50 px-3 py-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Units left from" hint={`${Math.round(remainder).toLocaleString()} units to record`}>
          <select value={facilityId} onChange={(e) => setFacilityId(e.target.value)} className={inputCls}>
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>
                {f.code} — {f.name}
              </option>
            ))}
          </select>
        </Field>
        {matchingLots.length > 0 && (
          <Field label="Also mark finished" hint="Lots still in production that made these units.">
            <div className="space-y-1 pt-1">
              {matchingLots.map((l) => (
                <label key={l.id} className="flex items-center gap-2 text-[12.5px] text-ink-soft">
                  <input
                    type="checkbox"
                    checked={finishIds.includes(l.id)}
                    onChange={(e) => setFinishIds((v) => (e.target.checked ? [...v, l.id] : v.filter((x) => x !== l.id)))}
                  />
                  PO {l.poNumber ?? "—"} · {Math.round(l.units).toLocaleString()} units
                </label>
              ))}
            </div>
          </Field>
        )}
        {finishIds.length > 0 && (
          <Field label="Expected production cost" hint="Optional — the supplier invoices later; an estimate keeps COG honest until then.">
            <input
              type="number"
              min="0"
              step="0.01"
              value={estimate}
              onChange={(e) => setEstimate(e.target.value)}
              placeholder="0.00"
              className={`${inputCls} tabular text-right`}
            />
          </Field>
        )}
      </div>
      {error && <div className="mt-2 rounded-lg border border-[#f0d3cb] bg-[#fdf2ef] px-3 py-2 text-[12.5px] text-negative">{error}</div>}
      <div className="mt-3 flex justify-end">
        <button
          onClick={confirm}
          disabled={pending || !facilityId}
          className="rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-bg hover:opacity-90 disabled:opacity-40"
        >
          {pending ? "Recording…" : "Record handoff"}
        </button>
      </div>
    </div>
  );
}
