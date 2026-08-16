"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Clock } from "@/components/icons";
import { SelectMenu } from "@/components/SelectMenu";
import { Card } from "@/components/ui";
import { Field, SaveBar } from "@/components/FormKit";
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

export function TimezoneSettings({
  initialTz,
  lastSyncAt,
  saveRef,
  hideSaveBar = false,
  onDirtyState,
}: {
  initialTz: string;
  lastSyncAt: string | null;
  saveRef?: EditorSaveRef;
  /** The onboarding wizard saves through its floating bar — hide the page-style SaveBar. */
  hideSaveBar?: boolean;
  /** Reports dirty state upward (null = clean) with save/discard the wizard bar can drive. */
  onDirtyState?: (s: { save: () => Promise<string | null>; discard: () => void } | null) => void;
}) {
  const router = useRouter();
  const { locale } = useMoney();
  const [tz, setTz] = useState(initialTz);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const zones = useZones(tz);
  const dirty = tz !== initialTz;

  // Wizard-bar integration: stable wrappers read the latest tz at call time.
  const barRef = useRef({ tz });
  barRef.current = { tz };
  useEffect(() => {
    if (!onDirtyState) return;
    onDirtyState(
      dirty
        ? {
            save: async () => {
              const r = await saveTimezone(barRef.current.tz);
              if (!r.ok) return r.error;
              setSaved(true);
              router.refresh();
              return null;
            },
            discard: () => {
              setTz(initialTz);
              setError(null);
            },
          }
        : null,
    );
    return () => onDirtyState(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-report on dirty flips only
  }, [dirty]);

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
          <SelectMenu
            value={tz}
            onChange={(v) => {
              setTz(v);
              setSaved(false);
            }}
            ariaLabel="Your timezone"
            options={zones.map((z) => ({ value: z.tz, label: z.label }))}
          />
        </Field>

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <span className="inline-flex items-center gap-1.5 text-[11.5px] text-muted">
            <Clock size={12} />
            Everything syncs itself — stock every minute, orders live, sales overnight · last synced {lastSynced}
          </span>
        </div>
      </Card>

      {!hideSaveBar && (
        <SaveBar
          dirty={dirty}
          pending={saving}
          error={error}
          saved={saved}
          onSave={save}
          onReset={() => {
            setTz(initialTz);
            setError(null);
          }}
        />
      )}
    </>
  );
}
