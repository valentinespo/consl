"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useExitAnimation } from "@/components/animate";
import { useRouter } from "next/navigation";
import { Bell, CheckCircle2, PackageSearch, ShoppingCart, Truck, X, Zap } from "@/components/icons";
import type { LucideIcon } from "@/components/icons";
import type { Alert } from "@/lib/alerts";
import { getHeaderNotifications, dismissNotification } from "@/app/settings/actions";

const SEV: Record<Alert["severity"], { bg: string; dot: string }> = {
  critical: { bg: "#fef2f2", dot: "#dc2626" },
  warn: { bg: "#fff7ed", dot: "#ea580c" },
};
const KIND_ICON: Record<Alert["kind"], LucideIcon> = { material: PackageSearch, reorder: ShoppingCart, expedite: Zap, ship: Truck };

/**
 * The header bell: a count badge and a drop-down feed of the app's alerts (what the dashboard
 * Notifications widget used to show). The feed loads lazily after mount so page loads stay light,
 * and a dismissed alert disappears immediately without waiting on the round-trip.
 */
export function NotificationsBell() {
  const router = useRouter();
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [open, setOpen] = useState(false);
  const menu = useExitAnimation(open, 170);
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    getHeaderNotifications()
      .then((a) => alive && setAlerts(a))
      .catch(() => alive && setAlerts([]));
    return () => {
      alive = false;
    };
  }, []);

  // Close on an outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function dismiss(key: string) {
    setBusy(key);
    start(async () => {
      await dismissNotification(key);
      setAlerts((prev) => (prev ? prev.filter((a) => a.key !== key) : prev));
      setBusy(null);
      router.refresh();
    });
  }

  const count = alerts?.length ?? 0;

  return (
    <div ref={wrap} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={count > 0 ? `Notifications (${count})` : "Notifications"}
        className={`relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface transition-colors ${
          open ? "text-ink" : "text-ink-soft hover:bg-surface-2 hover:text-ink"
        }`}
      >
        <Bell size={18} />
        {count > 0 && (
          <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-negative px-1 text-[10px] font-semibold leading-none text-white">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {menu.mounted && (
        <div
          role="menu"
          className={`${menu.closing ? "org-pop-out" : "org-pop"} absolute right-0 top-full z-50 mt-2 w-[min(92vw,360px)] overflow-hidden rounded-xl border border-border bg-surface shadow-xl`}
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="text-[13.5px] font-semibold text-ink">Notifications</span>
            {count > 0 && (
              <span className="rounded-full bg-negative px-2 py-0.5 text-[11px] font-semibold text-white">{count}</span>
            )}
          </div>

          {alerts === null ? (
            <div className="px-4 py-8 text-center text-[12.5px] text-muted">Loading…</div>
          ) : alerts.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-muted">
              <CheckCircle2 size={26} className="text-positive" />
              <span className="text-[12.5px]">All clear — nothing needs attention</span>
            </div>
          ) : (
            <div className="max-h-[min(60vh,420px)] space-y-2 overflow-y-auto p-3">
              {alerts.map((a) => {
                const s = SEV[a.severity];
                const Icon = KIND_ICON[a.kind];
                return (
                  <div
                    key={a.key}
                    className="flex items-start gap-2.5 rounded-lg border-l-[3px] bg-surface-2/60 py-2 pl-2.5 pr-2"
                    style={{ borderColor: s.dot }}
                  >
                    <span
                      className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
                      style={{ background: s.bg, color: s.dot }}
                    >
                      <Icon size={13} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12.5px] font-medium text-ink">{a.title}</div>
                      <div className="text-[11px] text-muted">{a.detail}</div>
                    </div>
                    <button
                      onClick={() => dismiss(a.key)}
                      disabled={busy === a.key}
                      title="Dismiss"
                      className="shrink-0 rounded-md p-1 text-muted hover:bg-black/5 hover:text-ink-soft disabled:opacity-40"
                    >
                      <X size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
