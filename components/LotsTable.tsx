"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, ChevronDown } from "@/components/icons";
import { ExpandRow } from "@/components/animate";
import { FacilityTag, SkuAvatar } from "@/components/ui";
import { LotLineCards, type LotLineSummary } from "@/components/LotLineCards";
import { LotDocsCell, type LotDoc } from "@/components/LotDocsCell";
import { useMoney } from "@/components/CurrencyProvider";
import { updateLotStatuses } from "@/app/lots/actions";

export type LotRow = {
  id: string;
  lotNr: number;
  poNumber: string | null;
  poDate: string | null;
  facility: string;
  status: string;
  paymentStatus: string;
  documents: LotDoc[];
  finishedAt: string | null;
  skus: { code: string; imageUrl: string | null }[];
  lines: LotLineSummary[];
  units: number;
  cogTotal: number;
  avgCogPerUnit: number;
  txnCount: number;
};

// Pill tints keyed by status value — text colour on the wrapper (so the caret matches), bg/border
// on the select itself.
const TEXT_CLS: Record<string, string> = {
  IN_PRODUCTION: "text-accent",
  FINISHED: "text-positive",
  PAID: "text-positive",
  DUE: "text-[#b45309]",
};
const BG_CLS: Record<string, string> = {
  IN_PRODUCTION: "bg-accent-soft border-accent/25",
  FINISHED: "bg-positive/12 border-positive/25",
  PAID: "bg-positive/12 border-positive/25",
  DUE: "bg-[#fdf6ec] border-[#f3dcb8]",
};

/** A pill that is also a dropdown — click to change the value; the change is staged, not saved,
 *  until the floating bar's Save. A violet ring marks a staged (unsaved) edit. */
function StatusSelect({
  value,
  edited,
  options,
  onChange,
}: {
  value: string;
  edited: boolean;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <span className={`relative inline-block ${TEXT_CLS[value] ?? "text-ink-soft"}`}>
      <select
        value={value}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onChange(e.target.value)}
        // Force the native dropdown arrow off (some engines ignore Tailwind's appearance-none) so
        // only the coloured caret below shows — no double chevron.
        style={{ appearance: "none", WebkitAppearance: "none", MozAppearance: "none" }}
        className={`cursor-pointer whitespace-nowrap rounded-full border py-0.5 pl-2.5 pr-6 text-[11px] font-medium text-current outline-none ${BG_CLS[value] ?? "border-border bg-surface-2"} ${edited ? "ring-2 ring-accent/40" : ""}`}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="text-ink">
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={11} className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-current opacity-60" />
    </span>
  );
}

export function LotsTable({ lots, facilities }: { lots: LotRow[]; facilities: string[] }) {
  const { money, perUnit, qty, date } = useMoney();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [facility, setFacility] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Staged status edits, keyed by lot id — committed together via the floating save bar.
  const [edits, setEdits] = useState<Record<string, { status?: string; paymentStatus?: string }>>({});
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const effStatus = (l: LotRow) => edits[l.id]?.status ?? l.status;
  const effPay = (l: LotRow) => edits[l.id]?.paymentStatus ?? l.paymentStatus;

  const stage = (l: LotRow, field: "status" | "paymentStatus", value: string) => {
    const original = field === "status" ? l.status : l.paymentStatus;
    setEdits((prev) => {
      const cur = { ...prev[l.id] };
      if (value === original) delete cur[field];
      else cur[field] = value;
      const next = { ...prev };
      if (Object.keys(cur).length === 0) delete next[l.id];
      else next[l.id] = cur;
      return next;
    });
  };

  const dirtyCount = Object.keys(edits).length;

  async function saveEdits() {
    setSaving(true);
    setSaveErr(null);
    try {
      const changes = Object.entries(edits).map(([lotId, e]) => ({
        lotId,
        status: e.status as "IN_PRODUCTION" | "FINISHED" | undefined,
        paymentStatus: e.paymentStatus as "PAID" | "DUE" | undefined,
      }));
      const res = await updateLotStatuses(changes);
      if (!res.ok) {
        setSaveErr(res.error ?? "Could not save.");
        return;
      }
      setEdits({});
      router.refresh();
    } catch {
      setSaveErr("Couldn't reach the server — reload and try again.");
    } finally {
      setSaving(false);
    }
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return lots.filter((l) => {
      if (facility !== "ALL" && l.facility !== facility) return false;
      if (status !== "ALL" && l.status !== status) return false;
      if (!needle) return true;
      return (
        String(l.lotNr).includes(needle) ||
        (l.poNumber ?? "").toLowerCase().includes(needle) ||
        l.skus.some((s) => s.code.toLowerCase().includes(needle))
      );
    });
  }, [lots, q, facility, status]);

  return (
    <div>
      {dirtyCount > 0 && (
        <div className="fixed left-1/2 top-4 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border border-border bg-surface px-4 py-2 shadow-lg">
          <span className="text-[12.5px] text-ink-soft">
            {dirtyCount} lot{dirtyCount > 1 ? "s" : ""} with unsaved status changes
          </span>
          {saveErr && <span className="text-[12px] text-negative">{saveErr}</span>}
          <button onClick={() => { setEdits({}); setSaveErr(null); }} disabled={saving} className="rounded-lg px-2.5 py-1 text-[12.5px] text-muted hover:text-ink disabled:opacity-40">
            Discard
          </button>
          <button onClick={saveEdits} disabled={saving} className="rounded-lg bg-ink px-3 py-1 text-[12.5px] font-medium text-bg hover:opacity-90 disabled:opacity-40">
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search lot #, PO or SKU…"
          className="h-9 w-64 rounded-lg border border-border bg-surface px-3 text-[13px] text-ink outline-none placeholder:text-muted focus:border-accent-strong"
        />
        <Select value={facility} onChange={setFacility} options={["ALL", ...facilities]} labelFor={(v) => (v === "ALL" ? "All facilities" : v)} />
        <Select
          value={status}
          onChange={setStatus}
          options={["ALL", "IN_PRODUCTION", "FINISHED"]}
          labelFor={(v) => (v === "ALL" ? "All statuses" : v === "IN_PRODUCTION" ? "In production" : "Finished")}
        />
        <span className="ml-auto text-[12.5px] text-muted">
          {filtered.length} of {lots.length} lots
        </span>
      </div>

      <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface">
        <table className="w-full min-w-[860px] text-[13px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
              <th rowSpan={2} className="border-b border-line px-4 font-medium align-middle">Lot / PO / Date</th>
              <th rowSpan={2} className="border-b border-line px-3 font-medium align-middle">SKUs</th>
              <th rowSpan={2} className="border-b border-line px-3 font-medium align-middle">Documents</th>
              <th rowSpan={2} className="border-b border-line px-3 font-medium align-middle">Facility</th>
              <th rowSpan={2} className="border-b border-line px-3 text-right font-medium align-middle">Units</th>
              <th rowSpan={2} className="border-b border-line px-3 text-right font-medium align-middle">Avg COG/unit</th>
              <th rowSpan={2} className="border-b border-line px-3 text-right font-medium align-middle">Total COG</th>
              <th rowSpan={2} className="border-b border-line px-3 text-center font-medium align-middle">Txns</th>
              {/* Grouped "Status" bar sits on a faintly greyed background, bordered left+right so the
                  group reads as one section; the borders live ONLY on the header, not the body. */}
              <th colSpan={2} className="border-b border-x border-line bg-surface-2/60 px-3 pt-1.5 pb-1 text-center text-[9.5px] font-medium tracking-wider">Status</th>
              <th rowSpan={2} className="border-b border-line px-4 align-middle"></th>
            </tr>
            <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
              <th className="border-b border-l border-line bg-surface-2/60 px-3 pb-2 pt-0.5 text-center font-medium">Production</th>
              <th className="border-b border-r border-line bg-surface-2/60 px-3 pb-2 pt-0.5 text-center font-medium">Payment</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((l) => {
              const open = expanded.has(l.id);
              const st = effStatus(l);
              const pay = effPay(l);
              return (
              <Fragment key={l.id}>
              <tr onClick={() => toggle(l.id)} className={`cursor-pointer border-b border-line last:border-0 ${open ? "bg-surface-2" : "hover:bg-surface-2"}`}>
                {/* Lot / PO / Date — merged so the small identifiers share one column. */}
                <td className="px-4 py-3 text-ink-soft">
                  <div className="flex items-start gap-2">
                    <ChevronRight size={15} className={`mt-0.5 shrink-0 text-muted transition-transform ${open ? "rotate-90" : ""}`} />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-medium text-ink">#{l.lotNr}</span>
                        {l.poNumber && <span className="text-[11px] text-muted">PO {l.poNumber}</span>}
                      </div>
                      <div className="whitespace-nowrap text-[11px] text-muted">{date(l.poDate)}</div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3">
                  <div className="flex -space-x-1.5">
                    {l.skus.slice(0, 5).map((s) => (
                      <SkuAvatar key={s.code} code={s.code} size={26} imageUrl={s.imageUrl} />
                    ))}
                    {l.skus.length > 5 && <span className="ml-2 text-[11px] text-muted">+{l.skus.length - 5}</span>}
                  </div>
                </td>
                <td className="px-3 py-3"><LotDocsCell documents={l.documents} /></td>
                <td className="px-3 py-3"><FacilityTag code={l.facility} /></td>
                <td className="px-3 py-3 text-right tabular">{qty(l.units)}</td>
                <td className="px-3 py-3 text-right tabular text-ink-soft">{perUnit(l.avgCogPerUnit)}</td>
                <td className="px-3 py-3 text-right font-medium tabular">{money(l.cogTotal)}</td>
                <td className="px-3 py-3 text-center tabular text-muted">{l.txnCount}</td>
                {/* Production — editable */}
                <td className="px-3 py-3 text-center">
                  <StatusSelect
                    value={st}
                    edited={edits[l.id]?.status != null}
                    onChange={(v) => stage(l, "status", v)}
                    options={[
                      { value: "IN_PRODUCTION", label: "In production" },
                      { value: "FINISHED", label: "Finished" },
                    ]}
                  />
                  {st === "FINISHED" && l.finishedAt && edits[l.id]?.status == null && (
                    <div className="mt-1 text-[10.5px] text-muted">Finished {date(l.finishedAt)}</div>
                  )}
                </td>
                {/* Payment — editable */}
                <td className="px-3 py-3 text-center">
                  <StatusSelect
                    value={pay}
                    edited={edits[l.id]?.paymentStatus != null}
                    onChange={(v) => stage(l, "paymentStatus", v)}
                    options={[
                      { value: "DUE", label: "Due" },
                      { value: "PAID", label: "Fully paid" },
                    ]}
                  />
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/lots/${l.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-[12.5px] font-medium text-accent hover:underline"
                  >
                    Open →
                  </Link>
                </td>
              </tr>
              <ExpandRow open={open} className="border-b border-line bg-surface-2">
                  <td colSpan={11} className="px-4 py-3">
                    <LotLineCards lines={l.lines} />
                  </td>
              </ExpandRow>
              </Fragment>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-10 text-center text-[13px] text-muted">
                  {lots.length === 0
                    ? "No production lots yet — create one to start tracking cost and stock."
                    : "No lots match your filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
  labelFor,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  labelFor: (v: string) => string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 rounded-lg border border-border bg-surface px-2.5 text-[13px] text-ink-soft outline-none focus:border-accent-strong"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {labelFor(o)}
        </option>
      ))}
    </select>
  );
}
