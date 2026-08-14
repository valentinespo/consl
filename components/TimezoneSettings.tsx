"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Clock } from "@/components/icons";
import { Card } from "@/components/ui";
import { Field, SaveBar, inputCls } from "@/components/FormKit";
import { useMoney } from "@/components/CurrencyProvider";
import { saveTimezone } from "@/app/settings/actions";
import type { EditorSaveRef } from "@/components/CompanyEditor";

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

/** Every zone the browser knows, labelled with its current offset and ordered west to east. */
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

export function TimezoneSettings({ initialTz, lastSyncAt, saveRef }: { initialTz: string; lastSyncAt: string | null; saveRef?: EditorSaveRef }) {
  const router = useRouter();
  const { locale } = useMoney();
  const [tz, setTz] = useState(initialTz);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const zones = useZones(tz);

  function save() {
    setError(null);
    startSave(async () => {
      const r = await saveTimezone(tz);
      if (r.ok) setSaved(true);
      else setError(r.error);
      router.refresh();
    });
  }

  // Parent-triggered save (the onboarding wizard's Continue) — a picked-but-unsaved zone must
  // not be silently lost. Unchanged = nothing to do.
  useEffect(() => {
    if (!saveRef) return;
    saveRef.current = async () => {
      if (tz === initialTz) return true;
      const r = await saveTimezone(tz);
      if (!r.ok) {
        setError(r.error);
        return false;
      }
      setSaved(true);
      router.refresh();
      return true;
    };
    return () => {
      saveRef.current = null;
    };
  });

  const lastSynced = lastSyncAt
    ? new Date(lastSyncAt).toLocaleString(locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "never";

  return (
    <>
      <Card>
        <div className="mb-4">
          <div className="text-[12px] font-medium uppercase tracking-wide text-muted">Time zone</div>
          <p className="mt-1.5 max-w-[62ch] text-[12.5px] text-muted">
            Sets where your day starts and ends, so daily sales and inventory value land on the right
            date. Stock from your connected channels updates every minute and sales overnight — both
            automatically, even if nobody opens the app.
          </p>
        </div>

        <Field label="Your timezone" hint={`Currently ${gmtLabel(tz)}.`}>
          <select value={tz} onChange={(e) => { setTz(e.target.value); setSaved(false); }} className={inputCls}>
            {zones.map((z) => (
              <option key={z.tz} value={z.tz}>
                {z.label}
              </option>
            ))}
          </select>
        </Field>

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <span className="inline-flex items-center gap-1.5 text-[11.5px] text-muted">
            <Clock size={12} />
            Everything syncs itself — stock every minute, orders live, sales overnight · last synced {lastSynced}
          </span>
        </div>
      </Card>

      <SaveBar
        dirty={tz !== initialTz}
        pending={saving}
        error={error}
        saved={saved}
        onSave={save}
        onReset={() => {
          setTz(initialTz);
          setError(null);
        }}
      />
    </>
  );
}
