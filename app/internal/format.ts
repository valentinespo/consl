import { ADS, BOOKKEEPING_TOOLS, CHANNELS, FULFILLMENT, LONG_TERM_STOCK, LOT_TOOLS, type Choice } from "@/components/apply/options";
import { LIVE_SUBSCRIPTION } from "@/lib/billing";

/** Stored option lists carry "other" inline, e.g. ["fba", "other:a friend's garage"]. */
export function listLabels(list: Choice[], stored: unknown): string[] {
  if (!Array.isArray(stored)) return [];
  return stored
    .map((k) => {
      if (typeof k !== "string") return null;
      if (k.startsWith("other:")) return k.slice(6).trim() || "Other";
      return list.find((c) => c.key === k)?.label ?? k;
    })
    .filter((x): x is string => !!x);
}

export function keyLabel(list: Choice[], key: string | null | undefined): string | null {
  if (!key) return null;
  return list.find((c) => c.key === key)?.label ?? key;
}

/** Sales channels are stored with their ballpark share: [{ key, label, share }], largest first. */
export function channelLines(stored: unknown): string[] {
  if (!Array.isArray(stored)) return [];
  return stored
    .map((c) => {
      if (!c || typeof c !== "object") return null;
      const o = c as { key?: string; label?: string; share?: number };
      const name = o.label || keyLabel(CHANNELS, o.key ?? null) || o.key || "?";
      return typeof o.share === "number" ? `${name} · ${o.share}%` : name;
    })
    .filter((x): x is string => !!x);
}

export { ADS, BOOKKEEPING_TOOLS, FULFILLMENT, LONG_TERM_STOCK, LOT_TOOLS };
export const CHANNELS_LIST = CHANNELS;

export const STATUS: Record<string, { label: string; pill: string }> = {
  started: { label: "Started", pill: "pill-neutral" },
  completed: { label: "Form done", pill: "pill-amber" },
  account_created: { label: "Account created", pill: "pill-amber" },
  call_booked: { label: "Call booked", pill: "pill-green" },
};

export type OrgBilling = { billingExempt: boolean; trialUnlockedAt: Date | null; subscriptionStatus: string | null };

/** Where a company stands with the paywall, in the admin's words. */
export function billingState(org: OrgBilling | null): { label: string; pill: string } {
  if (!org) return { label: "No company", pill: "pill-neutral" };
  if (org.billingExempt) return { label: "Exempt", pill: "pill-neutral" };
  if (org.subscriptionStatus === "past_due") return { label: "Past due", pill: "pill-amber" };
  if (LIVE_SUBSCRIPTION.has(org.subscriptionStatus ?? "")) return { label: org.subscriptionStatus === "active" ? "Subscribed" : "In trial", pill: "pill-green" };
  if (org.subscriptionStatus) return { label: org.subscriptionStatus === "canceled" ? "Cancelled" : org.subscriptionStatus, pill: "pill-red" };
  if (org.trialUnlockedAt) return { label: "Trial unlocked", pill: "pill-chart" };
  return { label: "Waiting for call", pill: "pill-amber" };
}

const TZ = "America/Argentina/Buenos_Aires";

export function fmtDate(d: Date | null | undefined): string {
  return d ? d.toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric", year: "numeric" }) : "—";
}

export function fmtDateTime(d: Date | null | undefined): string {
  return d ? d.toLocaleString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
}
