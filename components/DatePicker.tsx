"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight } from "@/components/icons";
import { useMoney } from "@/components/CurrencyProvider";
import { useExitAnimation } from "@/components/animate";

const DOW = ["S", "M", "T", "W", "T", "F", "S"];
const PANEL_W = 264;

const isoUTC = (d: Date) => d.toISOString().slice(0, 10);
/** Today as a local calendar date (not UTC — avoids an off-by-one near midnight). */
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** A month laid out as ISO day strings, padded with blanks so the 1st lands on its weekday. */
function monthGrid(year: number, month: number): (string | null)[] {
  const lead = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (string | null)[] = Array(lead).fill(null);
  for (let d = 1; d <= days; d++) cells.push(isoUTC(new Date(Date.UTC(year, month, d))));
  while (cells.length % 7) cells.push(null);
  return cells;
}

const monthName = (y: number, m: number, locale: string) =>
  new Date(Date.UTC(y, m, 1)).toLocaleDateString(locale, { month: "long", timeZone: "UTC" });

/**
 * A single-date picker in the app's brand language — the same calendar the dashboard's range
 * picker uses, pared down to one selectable day. Emits/receives an ISO `YYYY-MM-DD` string, so it
 * drops straight in where a native `<input type="date">` was. Portalled to the body so a form's
 * rounded overflow can't clip the popup.
 */
export function DatePicker({
  value,
  onChange,
  clearable = false,
  placeholder = "Select date",
  fullWidth = true,
  className = "",
  isDayDisabled,
  dayTitle,
}: {
  value: string;
  onChange: (iso: string) => void;
  clearable?: boolean;
  placeholder?: string;
  fullWidth?: boolean;
  className?: string;
  /** Lock individual days (greyed, unclickable) — e.g. days a facility had no stock. */
  isDayDisabled?: (iso: string) => boolean;
  /** Hover text per day — e.g. "Up to 300 units on this day" / "No stock to move on this day". */
  dayTitle?: (iso: string) => string | undefined;
}) {
  const { locale } = useMoney();
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [box, setBox] = useState<{ top: number; left: number } | null>(null);
  const open = box !== null;
  // The panel lingers through its exit animation after `box` clears — remember where it was.
  const lastBox = useRef(box);
  if (box) lastBox.current = box;
  const exit = useExitAnimation(open);

  const [month, setMonth] = useState(() => {
    const [y, m] = (value || localToday()).split("-").map(Number);
    return { y, m: m - 1 };
  });
  // Instant per-day tooltip (viewport coords, portalled): the panel clips its children with
  // overflow-hidden, and native `title` bubbles never show on un-hoverable disabled buttons.
  const [dayTip, setDayTip] = useState<{ day: string; x: number; y: number } | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btn.current?.getBoundingClientRect();
      if (!r) return;
      setBox({
        top: Math.min(r.bottom + 6, window.innerHeight - 320),
        left: Math.max(8, Math.min(r.left, window.innerWidth - PANEL_W - 8)),
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
    const [y, m] = (value || localToday()).split("-").map(Number);
    setMonth({ y, m: m - 1 });
    const r = btn.current!.getBoundingClientRect();
    setBox({
      top: Math.min(r.bottom + 6, window.innerHeight - 320),
      left: Math.max(8, Math.min(r.left, window.innerWidth - PANEL_W - 8)),
    });
  }

  function pick(day: string) {
    onChange(day);
    setDayTip(null);
    setBox(null);
  }

  const label = value
    ? new Date(`${value}T00:00:00Z`).toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
    : placeholder;
  const today = localToday();
  const prevMonth = { y: month.m === 0 ? month.y - 1 : month.y, m: month.m === 0 ? 11 : month.m - 1 };
  const nextMonth = { y: month.m === 11 ? month.y + 1 : month.y, m: month.m === 11 ? 0 : month.m + 1 };

  return (
    <>
      <button
        ref={btn}
        type="button"
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`inline-flex h-9 items-center justify-between gap-2 rounded-lg border border-border bg-surface px-2.5 text-[13px] outline-none transition-colors hover:border-ink/25 focus-visible:border-accent-strong ${fullWidth ? "w-full" : ""} ${value ? "text-ink" : "text-muted"} ${className}`}
      >
        <span className="truncate">{label}</span>
        <CalendarDays size={15} className="shrink-0 text-ink-soft" />
      </button>

      {mounted &&
        exit.mounted &&
        lastBox.current &&
        createPortal(
          <div
            ref={panel}
            role="dialog"
            aria-label="Choose a date"
            style={{ position: "fixed", top: lastBox.current.top, left: lastBox.current.left, width: PANEL_W }}
            className={`${exit.closing ? "dropdown-out" : "dropdown-in"} z-[300] overflow-hidden rounded-xl border border-border bg-surface p-3 shadow-2xl`}
          >
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[13px] font-medium text-ink">
                {monthName(month.y, month.m, locale)} {month.y}
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  aria-label="Previous month"
                  onClick={() => {
                    setMonth(prevMonth);
                    setDayTip(null);
                  }}
                  className="rounded-md p-1 text-ink-soft hover:bg-surface-2"
                >
                  <ChevronLeft size={15} />
                </button>
                <button
                  type="button"
                  aria-label="Next month"
                  onClick={() => {
                    setMonth(nextMonth);
                    setDayTip(null);
                  }}
                  className="rounded-md p-1 text-ink-soft hover:bg-surface-2"
                >
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-y-0.5 text-center" onMouseLeave={() => setDayTip(null)}>
              {DOW.map((d, i) => (
                <div key={i} className="pb-1 text-[10px] font-medium text-muted">
                  {d}
                </div>
              ))}
              {monthGrid(month.y, month.m).map((day, i) => {
                if (!day) return <div key={i} />;
                const selected = day === value;
                const isToday = day === today;
                const disabled = isDayDisabled?.(day) ?? false;
                // mousemove too, not just enter: month navigation swaps the day under a resting
                // cursor without a new mouseenter, which would leave the previous day's tip up.
                const showTip = dayTitle
                  ? (e: React.MouseEvent<HTMLButtonElement>) => {
                      if (dayTip?.day === day) return;
                      const r = e.currentTarget.getBoundingClientRect();
                      setDayTip({ day, x: r.left + r.width / 2, y: r.top });
                    }
                  : undefined;
                return (
                  <button
                    key={i}
                    type="button"
                    aria-disabled={disabled}
                    onMouseEnter={showTip}
                    onMouseMove={showTip}
                    onClick={() => !disabled && pick(day)}
                    className={`mx-auto flex h-8 w-8 items-center justify-center rounded-md text-[12.5px] transition-colors ${
                      disabled
                        ? "cursor-not-allowed text-muted/40"
                        : selected
                          ? "bg-chart font-medium text-white"
                          : isToday
                            ? "font-medium text-chart hover:bg-surface-2"
                            : "text-ink-soft hover:bg-surface-2"
                    }`}
                  >
                    {Number(day.slice(8))}
                  </button>
                );
              })}
            </div>

            <div className="mt-2.5 flex items-center justify-between border-t border-border pt-2.5">
              {clearable ? (
                <button
                  type="button"
                  onClick={() => {
                    onChange("");
                    setBox(null);
                  }}
                  className="rounded-md px-2 py-1 text-[12.5px] text-muted transition-colors hover:bg-surface-2 hover:text-ink-soft"
                >
                  Clear
                </button>
              ) : (
                <span />
              )}
              <button type="button" onClick={() => pick(today)} className="rounded-md px-2 py-1 text-[12.5px] font-medium text-chart transition-colors hover:bg-chart-soft">
                Today
              </button>
            </div>
          </div>,
          document.body,
        )}

      {mounted &&
        open &&
        dayTip &&
        dayTitle?.(dayTip.day) &&
        createPortal(
          <div
            style={{ position: "fixed", left: dayTip.x, top: dayTip.y - 6 }}
            className="pointer-events-none z-[310] -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[10.5px] font-medium text-bg shadow-lg"
          >
            {dayTitle(dayTip.day)}
          </div>,
          document.body,
        )}
    </>
  );
}
