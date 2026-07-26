"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Clock } from "lucide-react";
import { Card } from "@/components/ui";
import { Field, SaveBar, inputCls } from "@/components/FormKit";
import { useMoney } from "@/components/CurrencyProvider";
import { saveSettings, runSyncNow } from "@/app/settings/actions";

export type AppSettings = {
  syncEnabled: boolean;
  syncHour: number;
  syncMinute: number;
  syncTz: string;
  lastSyncAt: string | null;
  defaultMinMonths: number;
  defaultLeadMonths: number;
};

const pad2 = (n: number) => String(n).padStart(2, "0");

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? "bg-accent-strong" : "bg-border"}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
    </button>
  );
}

export function SyncSettings({ initial }: { initial: AppSettings }) {
  const router = useRouter();
  const { locale } = useMoney();
  const [s, setS] = useState(initial);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const [syncing, startSync] = useTransition();

  const set = <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => {
    setS((p) => ({ ...p, [k]: v }));
    setSaved(false);
  };

  const dirty =
    s.syncEnabled !== initial.syncEnabled ||
    s.syncHour !== initial.syncHour ||
    s.syncMinute !== initial.syncMinute ||
    s.syncTz !== initial.syncTz ||
    s.defaultMinMonths !== initial.defaultMinMonths ||
    s.defaultLeadMonths !== initial.defaultLeadMonths;

  function save() {
    setError(null);
    startSave(async () => {
      await saveSettings({
        syncEnabled: s.syncEnabled,
        syncHour: s.syncHour,
        syncMinute: s.syncMinute,
        syncTz: s.syncTz,
        defaultMinMonths: s.defaultMinMonths,
        defaultLeadMonths: s.defaultLeadMonths,
      });
      setSaved(true);
      router.refresh();
    });
  }

  function runNow() {
    setMsg(null);
    startSync(async () => {
      const r = await runSyncNow();
      setMsg(r.ok ? "Synced with Amazon just now." : r.error);
      router.refresh();
    });
  }

  const lastSynced = s.lastSyncAt
    ? new Date(s.lastSyncAt).toLocaleString(locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "never";

  return (
    <>
      <Card>
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <div className="text-[12px] font-medium uppercase tracking-wide text-muted">Automatic daily sync</div>
            <p className="mt-1.5 max-w-[62ch] text-[12.5px] text-muted">
              Pulls Amazon FBA/AWD stock and sales, and records the day&apos;s inventory value — even
              if nobody opens the app.
            </p>
          </div>
          <Toggle on={s.syncEnabled} onChange={(v) => set("syncEnabled", v)} />
        </div>

        <div className={`grid gap-3 sm:grid-cols-3 ${s.syncEnabled ? "" : "pointer-events-none opacity-50"}`}>
          <Field label="Hour" hint="24-hour clock.">
            <input
              type="number"
              min={0}
              max={23}
              value={s.syncHour}
              onChange={(e) => set("syncHour", Number(e.target.value))}
              className={`${inputCls} tabular`}
            />
          </Field>
          <Field label="Minute">
            <input
              type="number"
              min={0}
              max={59}
              value={s.syncMinute}
              onChange={(e) => set("syncMinute", Number(e.target.value))}
              className={`${inputCls} tabular`}
            />
          </Field>
          <Field label="Timezone" hint="Which clock the time above follows.">
            <input value={s.syncTz} onChange={(e) => set("syncTz", e.target.value)} className={inputCls} />
          </Field>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <button
            onClick={runNow}
            disabled={syncing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-[12.5px] font-medium text-ink-soft hover:text-ink disabled:opacity-60"
          >
            <RefreshCw size={13} className={syncing ? "animate-spin" : ""} />
            {syncing ? "Syncing…" : "Run sync now"}
          </button>
          <span className="inline-flex items-center gap-1.5 text-[11.5px] text-muted">
            <Clock size={12} />
            Runs daily at {pad2(s.syncHour)}:{pad2(s.syncMinute)} · last synced {lastSynced}
          </span>
        </div>
        {msg && <div className="mt-2 text-[12px] text-muted">{msg}</div>}
      </Card>

      <Card className="mt-4">
        <div className="mb-4">
          <div className="text-[12px] font-medium uppercase tracking-wide text-muted">Restock defaults</div>
          <p className="mt-1.5 max-w-[62ch] text-[12.5px] text-muted">
            How much cover you want to hold, and how long a production run takes. Used for every
            product that doesn&apos;t have its own override on the Inventory page.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Floor (months)" hint="Reorder once cover drops below this.">
            <input
              type="number"
              step={0.5}
              min={0}
              value={s.defaultMinMonths}
              onChange={(e) => set("defaultMinMonths", Number(e.target.value))}
              className={`${inputCls} tabular`}
            />
          </Field>
          <Field label="Lead time (months)" hint="Order to sellable stock.">
            <input
              type="number"
              step={0.5}
              min={0}
              value={s.defaultLeadMonths}
              onChange={(e) => set("defaultLeadMonths", Number(e.target.value))}
              className={`${inputCls} tabular`}
            />
          </Field>
        </div>
      </Card>

      <SaveBar
        dirty={dirty}
        pending={saving}
        error={error}
        saved={saved}
        onSave={save}
        onReset={() => {
          setS(initial);
          setError(null);
        }}
      />
    </>
  );
}
