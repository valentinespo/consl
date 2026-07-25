/** A collapsed stock summary row on a facility card. The row shows a label + total; hovering it
 *  turns the row blue and fades in a popover with the per-item detail. Pure CSS — no JS. */
export function StockSection({
  label,
  total,
  emptyLabel = "None",
  children,
}: {
  label: string;
  total: string | null; // null = nothing here (no popover)
  emptyLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="group/stock relative border-t border-line">
      <div className="-mx-1 flex items-baseline justify-between rounded-lg px-2 py-2 transition-colors group-hover/stock:bg-[#eff6ff]">
        <span className="text-[11px] uppercase tracking-wide text-muted transition-colors group-hover/stock:text-[#1d4ed8]">
          {label}
        </span>
        {total ? (
          <span className="tabular text-[13px] font-semibold text-ink">{total}</span>
        ) : (
          <span className="text-[12px] text-muted">{emptyLabel}</span>
        )}
      </div>

      {total && (
        <div className="pointer-events-none absolute inset-x-0 top-full z-30 mt-1 translate-y-1 rounded-xl border border-border bg-surface p-3 opacity-0 shadow-xl transition-all duration-150 group-hover/stock:translate-y-0 group-hover/stock:opacity-100">
          <div className="space-y-1.5">{children}</div>
        </div>
      )}
    </div>
  );
}
