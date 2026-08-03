"use client";

import { useState } from "react";
import { SkuAvatar } from "@/components/ui";
import { CaretDown } from "@/components/icons";

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
  lines: { sellerSku: string; code: string | null; imageUrl: string | null; qtyShipped: number; qtyReceived: number | null; unmapped: boolean }[];
};

const STATUS_PILL = (s: string, dead: boolean) =>
  dead ? "pill-red" : s === "CLOSED" ? "pill-green" : s === "RECEIVING" || s === "DELIVERED" ? "pill-chart" : "pill-amber";

/** Read-only mirror of the org's real platform shipments (FBA/AWD). Live shipments first;
 *  historical ones collapsed behind a toggle. Linking/actions arrive with the handoff cards. */
export function ShipmentsPanel({ shipments, dateFmt }: { shipments: ShipmentRow[]; dateFmt?: (iso: string) => string }) {
  const [showHistorical, setShowHistorical] = useState(false);
  const live = shipments.filter((s) => !s.historical && !s.ignored);
  const rest = shipments.filter((s) => s.historical || s.ignored);
  const fmt = dateFmt ?? ((iso: string) => iso);

  const Row = ({ s }: { s: ShipmentRow }) => (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-2 last:border-0">
      <span className="inline-flex items-center rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-[10.5px] font-medium text-ink-soft">
        {s.channel}
      </span>
      <span className="min-w-0 truncate text-[12.5px] font-medium text-ink" title={s.externalId}>
        {s.name ?? s.externalId}
      </span>
      <span className={`${STATUS_PILL(s.extStatus, s.dead)} inline-flex items-center rounded-full px-2 py-[3px] text-[10.5px] font-medium leading-none`}>
        {s.extStatus.toLowerCase()}
      </span>
      {s.ignored && (
        <span className="pill-neutral inline-flex items-center rounded-full px-2 py-[3px] text-[10.5px] font-medium leading-none" title="Amazon-internal shipment (e.g. AWD→FBA replenishment) — excluded from reconciliation">
          amazon-internal
        </span>
      )}
      <span className="text-[11px] text-muted">{fmt(s.effDateISO)}{s.destination ? ` · ${s.destination}` : ""}</span>
      <span className="ml-auto flex flex-wrap items-center gap-2">
        {s.lines.map((l) => (
          <span key={l.sellerSku} className="inline-flex items-center gap-1.5 text-[11.5px] text-ink-soft" title={l.sellerSku}>
            {l.code ? <SkuAvatar code={l.code} size={18} imageUrl={l.imageUrl} /> : null}
            <span className={l.unmapped ? "text-negative" : ""}>{l.code ?? `${l.sellerSku} (unmapped)`}</span>
            <span className="tabular text-muted">
              {l.qtyShipped}
              {l.qtyReceived != null && l.qtyReceived !== l.qtyShipped ? ` → ${l.qtyReceived}` : ""}
            </span>
          </span>
        ))}
      </span>
    </div>
  );

  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-surface">
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
