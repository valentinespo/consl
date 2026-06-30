"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Pill, FacilityTag, SkuAvatar } from "@/components/ui";
import { LotLineCards, type LotLineSummary } from "@/components/LotLineCards";
import { money, qty, date } from "@/lib/format";

export type RecentLot = {
  id: string;
  lotNr: number;
  poDate: string | Date | null;
  skus: { code: string; imageUrl: string | null }[];
  facility: string;
  units: number;
  cogTotal: number;
  status: string;
  lines: LotLineSummary[];
};

export function RecentLots({ lots }: { lots: RecentLot[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  return (
    <div className="overflow-x-auto">
    <table className="w-full min-w-[620px] text-[13px]">
      <thead>
        <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted">
          <th className="px-5 py-2 font-medium">Lot</th>
          <th className="px-2 py-2 font-medium">SKUs</th>
          <th className="px-2 py-2 font-medium">Facility</th>
          <th className="px-2 py-2 text-right font-medium">Units</th>
          <th className="px-2 py-2 text-right font-medium">COG</th>
          <th className="px-2 py-2 font-medium">Status</th>
          <th className="px-5 py-2"></th>
        </tr>
      </thead>
      <tbody>
        {lots.map((l) => {
          const open = expanded.has(l.id);
          return (
            <Fragment key={l.id}>
              <tr onClick={() => toggle(l.id)} className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-2">
                <td className="px-5 py-2.5">
                  <div className="flex items-center gap-2">
                    <ChevronRight size={14} className={`text-muted transition-transform ${open ? "rotate-90" : ""}`} />
                    <div>
                      <div className="font-medium text-ink">#{l.lotNr}</div>
                      <div className="text-[11px] text-muted">{date(l.poDate)}</div>
                    </div>
                  </div>
                </td>
                <td className="px-2 py-2.5">
                  <div className="flex -space-x-1.5">
                    {l.skus.slice(0, 4).map((s) => (
                      <SkuAvatar key={s.code} code={s.code} size={26} imageUrl={s.imageUrl} />
                    ))}
                  </div>
                </td>
                <td className="px-2 py-2.5">
                  <FacilityTag code={l.facility} />
                </td>
                <td className="px-2 py-2.5 text-right tabular">{qty(l.units)}</td>
                <td className="px-2 py-2.5 text-right tabular">{money(l.cogTotal)}</td>
                <td className="px-2 py-2.5">
                  <Pill kind={l.status}>{l.status === "IN_PRODUCTION" ? "In production" : "Finished"}</Pill>
                </td>
                <td className="px-5 py-2.5 text-right">
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
                  <td colSpan={7} className="px-4 py-3">
                    <LotLineCards lines={l.lines} />
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
    </div>
  );
}
