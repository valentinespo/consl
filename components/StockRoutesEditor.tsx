"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "@/components/icons";
import { saveStockRoutes, resetStockRoutes } from "@/app/(app)/reorder2/actions";
import type { Place, StockRoute } from "@/lib/reorder2-engine";

/**
 * The stock-routes grid: one row per facility that can SEND, one tick per facility it can send
 * TO. Reorder 2.0 suggests moves only along ticked routes. Shipping time is the one default for
 * every route — no per-route number, by design.
 */
export function StockRoutesEditor({
  places,
  routes,
  saved,
  shipDays,
  onClose,
}: {
  places: Place[];
  routes: StockRoute[];
  saved: boolean;
  shipDays: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [set, setSet] = useState<Set<string>>(new Set(routes.map((r) => `${r.from}>${r.to}`)));
  const [error, setError] = useState<string | null>(null);
  const real = places;
  const key = (from: string, to: string) => `${from}>${to}`;
  const toggle = (from: string, to: string) =>
    setSet((prev) => {
      const next = new Set(prev);
      const k = key(from, to);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const dirty = set.size !== routes.length || routes.some((r) => !set.has(key(r.from, r.to)));
  const kindLabel = (p: Place) => (p.kind === "own" ? "yours" : p.kind === "AMAZON_FBA" ? "Amazon FBA" : p.kind === "AMAZON_AWD" ? "Amazon AWD" : p.kind === "SHOPIFY" ? "Shopify" : "TikTok");

  return (
    <div className="mb-2 rounded-lg border border-border bg-surface-2 px-3 py-2.5">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-[12.5px] font-medium text-ink">Stock routes</div>
          <div className="text-[11px] text-muted">
            Tick where each place can send stock. Moves are only ever suggested along a ticked route, and every move takes the default shipping time ({shipDays} days).
            {!saved && " These are consl's suggestions from your movement history; save to keep them."}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await resetStockRoutes();
                if (r.ok) {
                  setSet(new Set(r.routes.map((x) => `${x.from}>${x.to}`)));
                  setError(null);
                  router.refresh();
                } else setError(r.error);
              })
            }
            className="text-[11.5px] text-muted hover:text-ink-soft disabled:opacity-60"
          >
            Reset to suggested
          </button>
          <button
            type="button"
            disabled={pending || !dirty}
            onClick={() =>
              start(async () => {
                const routesOut: StockRoute[] = [...set].map((k) => {
                  const [from, to] = k.split(">");
                  return { from, to };
                });
                const r = await saveStockRoutes(routesOut);
                if (r.ok) {
                  setError(null);
                  router.refresh();
                  onClose();
                } else setError(r.error);
              })
            }
            className="inline-flex items-center gap-1 rounded-lg bg-ink px-3 py-1.5 text-[12px] font-medium text-bg disabled:opacity-60"
          >
            <Check size={13} /> Save routes
          </button>
          <button type="button" onClick={onClose} className="text-[12px] text-muted hover:text-ink-soft">
            Cancel
          </button>
        </div>
      </div>
      {error && <div className="mb-2 text-[12px] text-negative">{error}</div>}
      <div className="overflow-x-auto">
        <table className="min-w-[520px] text-[12px]">
          <thead>
            <tr>
              <th className="py-1 pr-3 text-left font-medium text-muted">From ↓ &nbsp; to →</th>
              {real.map((p) => (
                <th key={p.id} className="px-2 py-1 text-center font-medium text-ink-soft" title={`${p.name} · ${kindLabel(p)}`}>
                  {p.code}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {real.map((from) => (
              <tr key={from.id} className="border-t border-line">
                <td className="py-1.5 pr-3 text-ink" title={`${from.name} · ${kindLabel(from)}`}>
                  <span className="font-medium">{from.code}</span> <span className="text-muted">{kindLabel(from)}</span>
                </td>
                {real.map((to) => (
                  <td key={to.id} className="px-2 py-1.5 text-center">
                    {from.id === to.id ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <input
                        type="checkbox"
                        checked={set.has(key(from.id, to.id))}
                        onChange={() => toggle(from.id, to.id)}
                        aria-label={`${from.code} can send to ${to.code}`}
                        className="h-3.5 w-3.5 accent-[var(--color-accent)]"
                      />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
