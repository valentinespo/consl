"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "@/components/icons";
import { ExpandRow } from "@/components/animate";
import { Pill, FacilityTag, SkuAvatar } from "@/components/ui";
import { LotLineCards, type LotLineSummary } from "@/components/LotLineCards";
import { useMoney } from "@/components/CurrencyProvider";

export type LotRow = {
  id: string;
  lotNr: number;
  poNumber: string | null;
  poDate: string | null;
  facility: string;
  status: string;
  paymentStatus: string;
  keyDocs: { label: string; present: boolean }[];
  finishedAt: string | null;
  skus: { code: string; imageUrl: string | null }[];
  lines: LotLineSummary[];
  units: number;
  cogTotal: number;
  avgCogPerUnit: number;
  txnCount: number;
};

export function LotsTable({ lots, facilities }: { lots: LotRow[]; facilities: string[] }) {
  const { money, perUnit, qty, date } = useMoney();
  const [q, setQ] = useState("");
  const [facility, setFacility] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

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
        <table className="w-full min-w-[800px] text-[13px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
              <th rowSpan={2} className="border-b border-line px-4 font-medium align-middle">PO date</th>
              <th rowSpan={2} className="border-b border-line px-3 font-medium align-middle">Lot</th>
              <th rowSpan={2} className="border-b border-line px-3 font-medium align-middle">SKUs</th>
              <th rowSpan={2} className="border-b border-line px-3 font-medium align-middle">Facility</th>
              <th rowSpan={2} className="border-b border-line px-3 text-right font-medium align-middle">Units</th>
              <th rowSpan={2} className="border-b border-line px-3 text-right font-medium align-middle">Avg COG/unit</th>
              <th rowSpan={2} className="border-b border-line px-3 text-right font-medium align-middle">Total COG</th>
              <th rowSpan={2} className="border-b border-line px-3 text-center font-medium align-middle">Txns</th>
              <th rowSpan={2} className="border-b border-line px-3 font-medium align-middle">Documents</th>
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
              return (
              <Fragment key={l.id}>
              <tr onClick={() => toggle(l.id)} className={`cursor-pointer border-b border-line last:border-0 ${open ? "bg-surface-2" : "hover:bg-surface-2"}`}>
                <td className="px-4 py-3 whitespace-nowrap text-ink-soft">
                  <div className="flex items-center gap-2">
                    <ChevronRight size={15} className={`text-muted transition-transform ${open ? "rotate-90" : ""}`} />
                    {date(l.poDate)}
                  </div>
                </td>
                <td className="px-3 py-3">
                  <div className="font-medium text-ink">#{l.lotNr}</div>
                  {l.poNumber && <div className="text-[11px] text-muted">PO {l.poNumber}</div>}
                </td>
                <td className="px-3 py-3">
                  <div className="flex -space-x-1.5">
                    {l.skus.slice(0, 5).map((s) => (
                      <SkuAvatar key={s.code} code={s.code} size={26} imageUrl={s.imageUrl} />
                    ))}
                    {l.skus.length > 5 && <span className="ml-2 text-[11px] text-muted">+{l.skus.length - 5}</span>}
                  </div>
                </td>
                <td className="px-3 py-3"><FacilityTag code={l.facility} /></td>
                <td className="px-3 py-3 text-right tabular">{qty(l.units)}</td>
                <td className="px-3 py-3 text-right tabular text-ink-soft">{perUnit(l.avgCogPerUnit)}</td>
                <td className="px-3 py-3 text-right font-medium tabular">{money(l.cogTotal)}</td>
                <td className="px-3 py-3 text-center tabular text-muted">{l.txnCount}</td>
                <td className="px-3 py-3">
                  {l.keyDocs.length === 0 ? (
                    <span className="text-[11px] text-muted">—</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {l.keyDocs.map((d) => (
                        <span
                          key={d.label}
                          title={d.present ? `${d.label} uploaded` : `${d.label} missing`}
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${
                            d.present ? "bg-accent-soft text-accent border-accent/25" : "bg-surface-2 text-muted border-border"
                          }`}
                        >
                          {d.label}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-3 py-3 text-center">
                  <Pill kind={l.status}>{l.status === "IN_PRODUCTION" ? "In production" : "Finished"}</Pill>
                  {l.status === "FINISHED" && l.finishedAt && (
                    <div className="mt-1 text-[10.5px] text-muted">Finished {date(l.finishedAt)}</div>
                  )}
                </td>
                <td className="px-3 py-3 text-center">
                  <Pill kind={l.paymentStatus}>{l.paymentStatus === "PAID" ? "Fully paid" : "Due"}</Pill>
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
                  <td colSpan={12} className="px-4 py-3">
                    <LotLineCards lines={l.lines} />
                  </td>
              </ExpandRow>
              </Fragment>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={12} className="px-4 py-10 text-center text-[13px] text-muted">
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
