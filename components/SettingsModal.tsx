"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { X, Check, RefreshCw, Clock, Building2, ChevronRight } from "lucide-react";
import { getAppSettings, saveSettings, runSyncNow } from "@/app/settings/actions";

type Settings = Awaited<ReturnType<typeof getAppSettings>>;

const pad2 = (n: number) => String(n).padStart(2, "0");

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [s, setS] = useState<Settings | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const [syncing, startSync] = useTransition();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    getAppSettings().then(setS);
  }, []);

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((p) => (p ? { ...p, [k]: v } : p));

  function save() {
    if (!s) return;
    startSave(async () => {
      await saveSettings({
        syncEnabled: s.syncEnabled,
        syncHour: s.syncHour,
        syncMinute: s.syncMinute,
        syncTz: s.syncTz,
        defaultMinMonths: s.defaultMinMonths,
        defaultLeadMonths: s.defaultLeadMonths,
      });
      router.refresh();
      onClose();
    });
  }

  function runNow() {
    setMsg(null);
    startSync(async () => {
      const r = await runSyncNow();
      setMsg(r.ok ? "Synced with Amazon just now." : r.error);
      const fresh = await getAppSettings();
      setS(fresh);
      router.refresh();
    });
  }

  const lastSynced = s?.lastSyncAt
    ? new Date(s.lastSyncAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "never";

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden />
      <div className="relative z-10 w-full max-w-[440px] overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-[15px] font-semibold text-ink">Settings</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-muted hover:bg-surface-2 hover:text-ink-soft">
            <X size={18} />
          </button>
        </div>

        {!s ? (
          <div className="px-5 py-10 text-center text-[13px] text-muted">Loading…</div>
        ) : (
          <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
            {/* Company, team and currency live on their own page — this is the way in. */}
            <Link
              href="/settings/company"
              onClick={onClose}
              className="mb-4 flex items-center gap-3 rounded-xl border border-border bg-surface-2/50 px-3 py-2.5 transition-colors hover:border-accent-strong hover:bg-accent-soft/30"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <Building2 size={16} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-ink">Company &amp; team</span>
                <span className="block text-[11.5px] text-muted">
                  Business details, currency &amp; number format, and who has access
                </span>
              </span>
              <ChevronRight size={16} className="shrink-0 text-muted" />
            </Link>

            <div className="mb-4 border-t border-line" />

            {/* Automatic daily sync */}
            <div className="mb-1 flex items-center justify-between">
              <div className="text-[13px] font-semibold text-ink">Automatic daily sync</div>
              <Toggle on={s.syncEnabled} onChange={(v) => set("syncEnabled", v)} />
            </div>
            <p className="mb-3 text-[11.5px] text-muted">
              Pulls Amazon FBA/AWD + sales and records the inventory-value snapshot once a day — even if no one opens the app.
            </p>

            <div className={`grid grid-cols-2 gap-3 ${s.syncEnabled ? "" : "pointer-events-none opacity-50"}`}>
              <label className="text-[11px] text-muted">
                <div className="mb-1">Run at (hour:min)</div>
                <div className="flex items-center gap-1">
                  <input type="number" min={0} max={23} value={s.syncHour} onChange={(e) => set("syncHour", Number(e.target.value))} className={inputCls + " w-16"} />
                  <span className="text-muted">:</span>
                  <input type="number" min={0} max={59} value={s.syncMinute} onChange={(e) => set("syncMinute", Number(e.target.value))} className={inputCls + " w-16"} />
                </div>
              </label>
              <label className="text-[11px] text-muted">
                <div className="mb-1">Timezone</div>
                <input value={s.syncTz} onChange={(e) => set("syncTz", e.target.value)} className={inputCls + " w-full"} />
              </label>
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted">
              <Clock size={12} /> Runs daily at {pad2(s.syncHour)}:{pad2(s.syncMinute)} · last synced {lastSynced}
            </div>

            <button
              onClick={runNow}
              disabled={syncing}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-[12px] font-medium text-ink-soft hover:text-ink disabled:opacity-60"
            >
              <RefreshCw size={13} className={syncing ? "animate-spin" : ""} /> {syncing ? "Syncing…" : "Run sync now"}
            </button>
            {msg && <div className="mt-2 text-[11.5px] text-muted">{msg}</div>}

            <div className="my-4 border-t border-line" />

            {/* Restock defaults */}
            <div className="mb-2 text-[13px] font-semibold text-ink">Restock defaults</div>
            <p className="mb-3 text-[11.5px] text-muted">Global floor + lead time used when a SKU has no per-SKU override.</p>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-[11px] text-muted">
                <div className="mb-1">Floor (months)</div>
                <input type="number" step={0.5} min={0} value={s.defaultMinMonths} onChange={(e) => set("defaultMinMonths", Number(e.target.value))} className={inputCls + " w-full"} />
              </label>
              <label className="text-[11px] text-muted">
                <div className="mb-1">Lead time (months)</div>
                <input type="number" step={0.5} min={0} value={s.defaultLeadMonths} onChange={(e) => set("defaultLeadMonths", Number(e.target.value))} className={inputCls + " w-full"} />
              </label>
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          <button onClick={onClose} className="text-[12.5px] text-muted hover:text-ink-soft">Cancel</button>
          <button
            onClick={save}
            disabled={saving || !s}
            className="inline-flex items-center gap-1 rounded-lg bg-ink px-3.5 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-60"
          >
            <Check size={14} /> {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const inputCls =
  "h-8 rounded-lg border border-border bg-surface px-2 text-[13px] tabular text-ink outline-none focus:border-accent-strong";

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
      className={`relative h-5 w-9 rounded-full transition-colors ${on ? "bg-accent-strong" : "bg-border"}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
    </button>
  );
}
