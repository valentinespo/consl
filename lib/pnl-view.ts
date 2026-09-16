import { RANGES, type RangeKey } from "@/lib/chart";
import { parsePnlBreakdown, type PnlBreakdown } from "@/lib/pnl-shared";

/**
 * The P&L tab remembers the last view this browser had — window, channel, breakdown — so leaving
 * the tab and coming back doesn't reset it. Per browser (localStorage), not per account: it's a
 * viewing preference, and it must never be read as data. Everything read back is validated.
 */
const KEY = "consl.pnl.view";

export type SavedPnlView = { range: { key: RangeKey; from: string; to: string }; channel: string; breakdown: PnlBreakdown };

const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

export function readSavedPnlView(): SavedPnlView | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<SavedPnlView>;
    const key = RANGES.some((r) => r.key === v.range?.key) ? (v.range!.key as RangeKey) : null;
    if (!key) return null;
    const from = isDay(v.range?.from) ? v.range!.from : "";
    const to = isDay(v.range?.to) ? v.range!.to : "";
    if (key === "custom" && !(from && to)) return null;
    return { range: { key, from, to }, channel: typeof v.channel === "string" ? v.channel : "", breakdown: parsePnlBreakdown(v.breakdown) };
  } catch {
    return null;
  }
}

export function saveSavedPnlView(view: SavedPnlView): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(view));
  } catch {
    // Storage may be blocked (private mode); the tab simply won't remember.
  }
}

/** The P&L link with the saved view attached, so the page opens straight on it (no flash). */
export function savedPnlHref(): string {
  const v = readSavedPnlView();
  if (!v) return "/pnl";
  const q = new URLSearchParams();
  q.set("range", v.range.key);
  if (v.range.key === "custom") {
    q.set("from", v.range.from);
    q.set("to", v.range.to);
  }
  if (v.channel) q.set("channel", v.channel.toLowerCase());
  if (v.breakdown !== "none") q.set("breakdown", v.breakdown);
  return `/pnl?${q.toString()}`;
}
