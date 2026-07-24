import { SkuAvatar, FacilityTag } from "@/components/ui";
import { DeleteMovement } from "@/components/DeleteMovement";
import { destinationLabel } from "@/lib/destinations";
import { qty, date as fmtDate } from "@/lib/format";

export type MovementRow = {
  id: string;
  date: Date;
  code: string;
  productName: string;
  imageUrl: string | null;
  quantity: number;
  fromCode: string;
  toCode: string | null;
  toDestination: string | null;
  notes: string | null;
};

/** The finished-goods movement history: what left where, when, and where it went. */
export function MovementsLedger({ movements }: { movements: MovementRow[] }) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface">
      <table className="w-full min-w-[720px] text-[13px]">
        <thead>
          <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted">
            <th className="px-5 py-2.5 font-medium">Date</th>
            <th className="px-3 py-2.5 font-medium">Product</th>
            <th className="px-3 py-2.5 text-right font-medium">Units</th>
            <th className="px-3 py-2.5 font-medium">From</th>
            <th className="px-3 py-2.5 font-medium">To</th>
            <th className="px-3 py-2.5 font-medium">Note</th>
            <th className="px-5 py-2.5"></th>
          </tr>
        </thead>
        <tbody>
          {movements.map((m) => (
            <tr key={m.id} className="border-b border-line last:border-0">
              <td className="whitespace-nowrap px-5 py-2.5 text-muted">{fmtDate(m.date)}</td>
              <td className="px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <SkuAvatar code={m.code} size={24} imageUrl={m.imageUrl} />
                  <span className="font-medium text-ink">{m.code}</span>
                </div>
              </td>
              <td className="tabular px-3 py-2.5 text-right font-medium">{qty(m.quantity)}</td>
              <td className="px-3 py-2.5">
                <FacilityTag code={m.fromCode} />
              </td>
              <td className="px-3 py-2.5">
                {m.toCode ? <FacilityTag code={m.toCode} /> : <span className="text-ink-soft">{destinationLabel(m.toDestination)}</span>}
              </td>
              <td className="max-w-[220px] truncate px-3 py-2.5 text-[12px] text-muted">{m.notes ?? "—"}</td>
              <td className="px-5 py-2.5 text-right">
                <DeleteMovement id={m.id} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
