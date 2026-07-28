"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "@/components/icons";
import { RANGES, rangeBounds, type RangeKey } from "@/lib/chart";

export type Range = { key: RangeKey; from: string; to: string };

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const PANEL_W = 604;
// On a narrow phone the fixed panel would overflow; cap it to the viewport with a small margin.
const panelW = () => (typeof window !== "undefined" ? Math.min(PANEL_W, window.innerWidth - 16) : PANEL_W);

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** A month laid out as ISO day strings, padded with blanks so the 1st lands on its weekday. */
function monthGrid(year: number, month: number): (string | null)[] {
  const lead = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (string | null)[] = Array(lead).fill(null);
  for (let d = 1; d <= days; d++) cells.push(iso(new Date(Date.UTC(year, month, d))));
  while (cells.length % 7) cells.push(null);
  return cells;
}

const monthName = (y: number, m: number, locale: string) =>
  new Date(Date.UTC(y, m, 1)).toLocaleDateString(locale, { month: "long", timeZone: "UTC" });

const longDay = (day: string, locale: string) =>
  day
    ? new Date(`${day}T00:00:00Z`).toLocaleDateString(locale, {
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : "—";

/**
 * Preset rail + two-month calendar for choosing the chart's window.
 *
 * Portalled to the body because the cards it opens from clip their own overflow (rounded corners),
 * which would slice the panel in half. Position is therefore in viewport coordinates, re-measured
 * whenever the page moves.
 */
export function DateRangePicker({
  value,
  onChange,
  newest,
  oldest,
  locale,
}: {
  value: Range;
  onChange: (r: Range) => void;
  newest: string; // last day with data — nothing after this is selectable
  oldest: string;
  locale: string;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [box, setBox] = useState<{ top: number; left: number } | null>(null);

  // Edits are staged so Cancel can genuinely abandon them.
  const [draft, setDraft] = useState<Range>(value);
  const [picking, setPicking] = useState<"from" | "to">("from");
  const [month, setMonth] = useState(() => {
    const [y, m] = newest.split("-").map(Number);
    return { y, m: m - 1 };
  });

  useEffect(() => setMounted(true), []);

  const open = box !== null;
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btn.current?.getBoundingClientRect();
      if (!r) return;
      setBox({
        top: Math.min(r.bottom + 6, window.innerHeight - 380),
        // Right-aligned to the trigger, then pulled back inside the viewport.
        left: Math.max(8, Math.min(r.right - panelW(), window.innerWidth - panelW() - 8)),
      });
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setBox(null);
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !btn.current?.contains(t)) setBox(null);
    };
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  function toggle() {
    if (open) return setBox(null);
    const r = btn.current!.getBoundingClientRect();
    const b = rangeBounds(value.key, newest, value.from, value.to);
    setDraft({ key: value.key, from: b.from ?? oldest, to: b.to ?? newest });
    setPicking("from");
    const [y, m] = (b.to ?? newest).split("-").map(Number);
    setMonth({ y, m: m - 1 });
    setBox({
      top: Math.min(r.bottom + 6, window.innerHeight - 380),
      left: Math.max(8, Math.min(r.right - panelW(), window.innerWidth - panelW() - 8)),
    });
  }

  /** Clicking a day sets whichever end is being picked, then flips to the other. */
  function pick(day: string) {
    if (day > newest) return;
    setDraft((d) => {
      if (picking === "from") return { key: "custom", from: day, to: day > d.to ? day : d.to };
      if (day < d.from) return { key: "custom", from: day, to: d.from };
      return { key: "custom", from: d.from, to: day };
    });
    setPicking((p) => (p === "from" ? "to" : "from"));
  }

  function choosePreset(key: RangeKey) {
    const b = rangeBounds(key, newest, draft.from, draft.to);
    setDraft({ key, from: b.from ?? oldest, to: b.to ?? newest });
    if (key !== "custom") {
      const [y, m] = (b.to ?? newest).split("-").map(Number);
      setMonth({ y, m: m - 1 });
    }
  }

  // The trigger names the preset on the left and spells out the dates it resolves to on the
  // right — "Last 30 days | 📅 Jun 29 - Jul 28, 2026" — so the window is never ambiguous.
  const presetLabel = value.key === "custom" ? "Custom" : (RANGES.find((r) => r.key === value.key)?.label ?? "");
  const rangeText = useMemo(() => {
    const b = rangeBounds(value.key, newest, value.from, value.to);
    const from = b.from ?? oldest;
    const to = b.to ?? newest;
    const f = new Date(`${from}T00:00:00Z`);
    const t = new Date(`${to}T00:00:00Z`);
    const sameYear = f.getUTCFullYear() === t.getUTCFullYear();
    const start = f.toLocaleDateString(locale, {
      month: "short",
      day: "numeric",
      ...(sameYear ? {} : { year: "numeric" }),
      timeZone: "UTC",
    });
    const end = t.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
    return `${start} - ${end}`;
  }, [value, newest, oldest, locale]);

  const prevMonth = { y: month.m === 0 ? month.y - 1 : month.y, m: month.m === 0 ? 11 : month.m - 1 };

  function Month({ y, m }: { y: number; m: number }) {
    return (
      <div className="w-[196px]">
        <div className="mb-2 text-center text-[13px] font-medium text-ink">
          {monthName(y, m, locale)} {y}
        </div>
        <div className="grid grid-cols-7 gap-y-0.5 text-center">
          {DOW.map((d) => (
            <div key={d} className="pb-1 text-[10px] font-medium text-muted">
              {d}
            </div>
          ))}
          {monthGrid(y, m).map((day, i) => {
            if (!day) return <div key={i} />;
            const disabled = day > newest;
            const inRange = day >= draft.from && day <= draft.to;
            const isEnd = day === draft.from || day === draft.to;
            return (
              <button
                key={i}
                type="button"
                disabled={disabled}
                onClick={() => pick(day)}
                className={`mx-auto h-7 w-7 rounded-md text-[12px] leading-7 transition-colors ${
                  disabled
                    ? "cursor-default text-muted/40"
                    : isEnd
                      ? "bg-chart font-medium text-white"
                      : inRange
                        ? "bg-chart-soft text-ink"
                        : "text-ink-soft hover:bg-surface-2"
                }`}
              >
                {Number(day.slice(8))}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <>
      <button
        ref={btn}
        type="button"
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex h-9 items-stretch overflow-hidden rounded-[10px] border border-border bg-surface text-[12.5px] outline-none transition-colors hover:border-chart focus-visible:border-chart"
      >
        <span className="flex items-center gap-1.5 px-3 font-medium text-ink">
          {presetLabel}
          <ChevronDown size={13} className="text-muted" />
        </span>
        <span aria-hidden className="w-px self-stretch bg-border" />
        <span className="flex items-center gap-2 px-3 text-ink">
          <CalendarDays size={14} className="text-ink-soft" />
          {rangeText}
        </span>
      </button>

      {mounted &&
        box &&
        createPortal(
          <div
            ref={panel}
            role="dialog"
            aria-label="Choose a date range"
            style={{ position: "fixed", top: box.top, left: box.left, width: panelW() }}
            className="z-[300] flex overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
          >
            <div className="w-[150px] shrink-0 border-r border-border py-1.5">
              {RANGES.map((r, i) => (
                <div key={r.key}>
                  {i > 0 && RANGES[i - 1].group !== r.group && (
                    <div className="my-1.5 border-t border-border" />
                  )}
                  <button
                    type="button"
                    onClick={() => choosePreset(r.key)}
                    className={`block w-full px-3.5 py-1.5 text-left text-[12.5px] transition-colors ${
                      draft.key === r.key
                        ? "bg-chart-soft font-medium text-chart"
                        : "text-ink-soft hover:bg-surface-2"
                    }`}
                  >
                    {r.label}
                  </button>
                </div>
              ))}
            </div>

            <div className="flex min-w-0 flex-1 flex-col p-3.5">
              <div className="flex items-center gap-2">
                {(["from", "to"] as const).map((end, i) => (
                  <span key={end} className="contents">
                    {i === 1 && <span className="text-muted">→</span>}
                    <button
                      type="button"
                      onClick={() => setPicking(end)}
                      className={`h-9 min-w-0 flex-1 truncate rounded-lg border px-2.5 text-left text-[12.5px] transition-colors ${
                        picking === end
                          ? "border-chart text-ink"
                          : "border-border text-ink-soft hover:border-chart"
                      }`}
                    >
                      {longDay(end === "from" ? draft.from : draft.to, locale)}
                    </button>
                  </span>
                ))}
              </div>

              <div className="relative mt-3.5 flex gap-4">
                <button
                  type="button"
                  aria-label="Previous month"
                  onClick={() => setMonth(prevMonth)}
                  className="absolute -top-0.5 left-0 rounded-md p-1 text-ink-soft hover:bg-surface-2"
                >
                  <ChevronLeft size={15} />
                </button>
                <button
                  type="button"
                  aria-label="Next month"
                  onClick={() =>
                    setMonth({ y: month.m === 11 ? month.y + 1 : month.y, m: month.m === 11 ? 0 : month.m + 1 })
                  }
                  className="absolute -top-0.5 right-0 rounded-md p-1 text-ink-soft hover:bg-surface-2"
                >
                  <ChevronRight size={15} />
                </button>
                <Month y={prevMonth.y} m={prevMonth.m} />
                <div className="w-px bg-border" />
                <Month y={month.y} m={month.m} />
              </div>

              <div className="mt-3.5 flex justify-end gap-2 border-t border-border pt-3">
                <button
                  type="button"
                  onClick={() => setBox(null)}
                  className="rounded-lg border border-border bg-surface px-3.5 py-1.5 text-[12.5px] text-ink-soft hover:bg-surface-2"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onChange(draft);
                    setBox(null);
                  }}
                  className="rounded-lg bg-ink px-3.5 py-1.5 text-[12.5px] font-medium text-bg hover:opacity-90"
                >
                  Apply
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
