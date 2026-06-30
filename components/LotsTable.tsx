"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Pill, FacilityTag, SkuAvatar } from "@/components/ui";
import { LotLineCards, type LotLineSummary } from "@/components/LotLineCards";
import { money, qty, perUnit, date } from "@/lib/format";

export type LotRow = {
  id: string;
  lotNr: number;
  poNumber: string | null;
  poDate: string | null;
  facility: string;
  status: string;
  skus: { code: string; imageUrl: string | null }[];
  lines: LotLineSummary[];
  units: number;
  cogTotal: number;
  avgCogPerUnit: number;
  txnCount: number;
};

export function LotsTable({ lots, facilities }: { lots: LotRow[]; facilities: string[] }) {
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

      <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted">
              <th className="px-4 py-2.5 font-medium">Lot</th>
              <th className="px-3 py-2.5 font-medium">SKUs</th>
              <th className="px-3 py-2.5 font-medium">Facility</th>
              <th className="px-3 py-2.5 text-right font-medium">Units</th>
              <th className="px-3 py-2.5 text-right font-medium">Avg COG/unit</th>
              <th className="px-3 py-2.5 text-right font-medium">Total COG</th>
              <th className="px-3 py-2.5 text-center font-medium">Txns</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((l) => {
              const open = expanded.has(l.id);
              return (
              <Fragment key={l.id}>
              <tr onClick={() => toggle(l.id)} className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-2">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <ChevronRight size={15} className={`text-muted transition-transform ${open ? "rotate-90" : ""}`} />
                    <div>
                      <div className="font-medium text-ink">#{l.lotNr}</div>
                      <div className="text-[11px] text-muted">{l.poNumber ? `PO ${l.poNumber}` : date(l.poDate)}</div>
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
                <td className="px-3 py-3"><FacilityTag code={l.facility} /></td>
                <td className="px-3 py-3 text-right tabular">{qty(l.units)}</td>
                <td className="px-3 py-3 text-right tabular text-ink-soft">{perUnit(l.avgCogPerUnit)}</td>
                <td className="px-3 py-3 text-right font-medium tabular">{money(l.cogTotal)}</td>
                <td className="px-3 py-3 text-center tabular text-muted">{l.txnCount}</td>
                <td className="px-3 py-3">
                  <Pill kind={l.status}>{l.status === "IN_PRODUCTION" ? "In production" : "Finished"}</Pill>
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/lots/${l.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-[12.5px] font-medium text-positive hover:underline"
                  >
                    Open →
                  </Link>
                </td>
              </tr>
              {open && (
                <tr className="border-b border-line bg-surface-2/60">
                  <td colSpan={9} className="px-4 py-3">
                    <LotLineCards lines={l.lines} />
                  </td>
                </tr>
              )}
              </Fragment>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-[13px] text-muted">
                  No lots match your filters.
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
