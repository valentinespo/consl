"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Clock } from "lucide-react";
import { Card } from "@/components/ui";
import { Field, SaveBar, inputCls } from "@/components/FormKit";
import { useMoney } from "@/components/CurrencyProvider";
import { saveSettings, runSyncNow } from "@/app/settings/actions";
import { BUFFER_HELP, FLOOR_HELP, LEAD_HELP, REORDER_TO_HELP, SHIP_HELP } from "@/lib/restock-help";

export type AppSettings = {
  syncEnabled: boolean;
  syncHour: number;
  syncMinute: number;
  syncTz: string;
  lastSyncAt: string | null;
  defaultMinMonths: number;
  defaultLeadMonths: number;
  shipDays: number;
  shipBufferX: number;
  defaultReorderTo: number;
};

const pad2 = (n: number) => String(n).padStart(2, "0");

/** "GMT-03:00" for a zone, as of right now — offsets shift with daylight saving, so this is
 *  computed rather than stored. */
function gmtLabel(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  } catch {
    return "GMT";
  }
}

/** Minutes east of GMT, for sorting the list the way people read it. */
function gmtMinutes(tz: string): number {
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(gmtLabel(tz));
  if (!m) return 0;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/** Every zone the browser knows, labelled with its current offset and ordered west to east.
 *  Computed once per mount — there are a few hundred and the offsets only change twice a year. */
function useZones(current: string) {
  return useMemo(() => {
    let names: string[] = [];
    try {
      names = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
    } catch {
      names = [];
    }
    if (!names.includes(current)) names = [current, ...names];
    return names
      .map((tz) => ({ tz, label: `(${gmtLabel(tz)}) ${tz.replace(/_/g, " ")}`, mins: gmtMinutes(tz) }))
      .sort((a, b) => a.mins - b.mins || a.tz.localeCompare(b.tz));
  }, [current]);
}



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
  const zones = useZones(s.syncTz);

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
    s.defaultLeadMonths !== initial.defaultLeadMonths ||
    s.shipDays !== initial.shipDays ||
    s.shipBufferX !== initial.shipBufferX ||
    s.defaultReorderTo !== initial.defaultReorderTo;

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
        shipDays: s.shipDays,
        shipBufferX: s.shipBufferX,
        defaultReorderTo: s.defaultReorderTo,
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

        <div className={`grid gap-3 sm:grid-cols-[160px_1fr] ${s.syncEnabled ? "" : "pointer-events-none opacity-50"}`}>
          <Field label="Run at" hint="Your local clock, below.">
            <input
              type="time"
              value={`${pad2(s.syncHour)}:${pad2(s.syncMinute)}`}
              onChange={(e) => {
                const [h, m] = e.target.value.split(":");
                // An empty time input yields "", which would otherwise store NaN.
                if (h === undefined || m === undefined || e.target.value === "") return;
                setS((p) => ({ ...p, syncHour: Number(h), syncMinute: Number(m) }));
                setSaved(false);
              }}
              className={`${inputCls} tabular`}
            />
          </Field>
          <Field label="Timezone" hint={`Which clock that time follows — currently ${gmtLabel(s.syncTz)}.`}>
            <select value={s.syncTz} onChange={(e) => set("syncTz", e.target.value)} className={inputCls}>
              {zones.map((z) => (
                <option key={z.tz} value={z.tz}>
                  {z.label}
                </option>
              ))}
            </select>
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
            How much cover you want to hold, how long stock takes to make and to move, and
            how much an order tops you back up to. Used for every product that doesn&apos;t have its
            own override on the Inventory page — except shipping time, which is always org-wide.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Floor (months)" hint="Reorder once cover drops below this." help={FLOOR_HELP}>
            <input
              type="number"
              step={0.5}
              min={0}
              value={s.defaultMinMonths}
              onChange={(e) => set("defaultMinMonths", Number(e.target.value))}
              className={`${inputCls} tabular`}
            />
          </Field>
          <Field label="Lead time (months)" hint="Placing a run to sellable stock." help={LEAD_HELP}>
            <input
              type="number"
              step={0.5}
              min={0}
              value={s.defaultLeadMonths}
              onChange={(e) => set("defaultLeadMonths", Number(e.target.value))}
              className={`${inputCls} tabular`}
            />
          </Field>
          <Field label="Shipping time (days)" hint="Your warehouse to the channel." help={SHIP_HELP}>
            <input
              type="number"
              step={1}
              min={0}
              value={s.shipDays}
              onChange={(e) => set("shipDays", Number(e.target.value))}
              className={`${inputCls} tabular`}
            />
          </Field>
          <Field
            label="Shipping buffer (×)"
            hint={`Start shipping under ${Math.round(s.shipDays * s.shipBufferX)} days of cover.`}
            help={BUFFER_HELP}
          >
            <input
              type="number"
              step={0.5}
              min={0}
              value={s.shipBufferX}
              onChange={(e) => set("shipBufferX", Number(e.target.value))}
              className={`${inputCls} tabular`}
            />
          </Field>
          <Field label="Reorder to (months)" hint="How much an order tops you up to." help={REORDER_TO_HELP}>
            <input
              type="number"
              step={0.5}
              min={0.5}
              value={s.defaultReorderTo}
              onChange={(e) => set("defaultReorderTo", Number(e.target.value))}
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
