/**
 * The early-access questionnaire: every option list and the answer shape, in one plain module
 * (no JSX, no "server-only") so the client flow renders from it and the server action validates
 * against it. Keys are what gets stored; labels can be reworded without touching saved rows.
 */

export type Choice = {
  key: string;
  label: string;
  /** Muted second line under the label. */
  hint?: string;
  /** A platform mark from /public (Amazon, Shopify, TikTok). */
  mark?: string;
  /** A short monogram drawn on a neutral tile when there's no mark to show. */
  mono?: string;
  /** A glyph from components/icons for the tile, when neither a mark nor a monogram fits. */
  icon?: "buildings" | "truck" | "package" | "warehouse" | "tag" | "layers";
  /** Reveals a free-text box ("Which one?") when chosen. */
  other?: boolean;
  /** Picking this clears every other choice and vice versa ("None of these"). */
  exclusive?: boolean;
};

export const CHANNELS: Choice[] = [
  { key: "amazon", label: "Amazon", mark: "/integrations/amazon.png" },
  { key: "shopify", label: "Shopify", mark: "/integrations/shopify.png" },
  { key: "tiktok", label: "TikTok Shop", mark: "/integrations/tiktok.png" },
  { key: "walmart", label: "Walmart", mono: "W" },
  { key: "etsy", label: "Etsy", mono: "E" },
  { key: "ebay", label: "eBay", mono: "e" },
  { key: "woocommerce", label: "WooCommerce", mono: "Woo" },
  { key: "website", label: "Own website", hint: "Another storefront platform", mono: "www" },
  { key: "wholesale", label: "Wholesale / Retail", hint: "Stores, distributors, B2B", icon: "buildings" },
  { key: "other", label: "Somewhere else", other: true, icon: "tag" },
];

export const FULFILLMENT: Choice[] = [
  { key: "fba", label: "Amazon FBA", mark: "/integrations/amazon-fba.png" },
  { key: "mcf", label: "Amazon MCF", hint: "FBA stock shipping your other channels' orders", mark: "/integrations/amazon.png" },
  { key: "3pl", label: "A 3PL", hint: "A third-party warehouse ships for you", icon: "truck" },
  { key: "fbt", label: "Fulfilled by TikTok", mark: "/integrations/tiktok.png" },
  { key: "inhouse", label: "In-house", hint: "We pack and ship ourselves", icon: "package" },
  { key: "other", label: "Something else", other: true, icon: "tag" },
];

export const LONG_TERM_STOCK: Choice[] = [
  { key: "awd", label: "Amazon AWD", mark: "/integrations/amazon-awd.png" },
  { key: "3pl", label: "A 3PL warehouse", icon: "truck" },
  { key: "copacker", label: "Manufacturer / co-packer", hint: "Finished goods wait at the factory", icon: "buildings" },
  { key: "own", label: "Our own warehouse or office", icon: "warehouse" },
  { key: "other", label: "Somewhere else", other: true, icon: "tag" },
  { key: "none", label: "No, everything sits at the channels", exclusive: true, icon: "layers" },
];

export const LOT_TOOLS: Choice[] = [
  { key: "spreadsheets", label: "Spreadsheets" },
  { key: "software", label: "Inventory software or an ERP" },
  { key: "paper", label: "Paper, notes or chat messages" },
  { key: "copacker", label: "Our co-packer keeps the records" },
  { key: "none", label: "We don't track them yet" },
  { key: "other", label: "Something else" },
];

export const ADS: Choice[] = [
  { key: "amazon_ppc", label: "Amazon PPC", mark: "/integrations/amazon.png" },
  { key: "meta", label: "Meta Ads", hint: "Facebook and Instagram", mark: "/integrations/meta-mark.png" },
  { key: "tiktok_ads", label: "TikTok Ads", mark: "/integrations/tiktok.png" },
  { key: "google", label: "Google Ads", mono: "G" },
  { key: "other", label: "Somewhere else", other: true, icon: "tag" },
  { key: "none", label: "Not advertising yet", exclusive: true, icon: "layers" },
];

export const BOOKKEEPING_TOOLS: Choice[] = [
  { key: "quickbooks", label: "QuickBooks" },
  { key: "xero", label: "Xero" },
  { key: "spreadsheets", label: "Spreadsheets" },
  { key: "accountant", label: "An accountant or bookkeeper handles it" },
  { key: "finance_tool", label: "Another ecommerce finance tool" },
  { key: "none", label: "Nothing yet, honestly" },
  { key: "other", label: "Something else" },
];

/** Minimum length for the long answer — the one question we insist people actually write. */
export const CHALLENGE_MIN = 150;

/** "northwind.com", "www.amazon.com/stores/…" or a full URL → the https:// form, or null if it
 *  isn't a plausible web address. A scheme is optional; the host must look like a real domain. */
export function normalizeBrandUrl(raw: string): string | null {
  const v = raw.trim();
  if (!v || /\s/.test(v)) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(u.hostname)) return null;
    return u.href;
  } catch {
    return null;
  }
}

export const validBrandUrl = (raw: string) => normalizeBrandUrl(raw) !== null;

/** What to print for a stored brand URL: the address without the scheme, "www." or a trailing slash. */
export const brandUrlLabel = (url: string) => url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");

export type Answers = {
  fullName: string;
  companyName: string;
  /** Their website, or an Amazon storefront / main listing — whatever shows the brand. */
  brandUrl: string;
  email: string;
  phone: string;
  channels: string[];
  channelOther: string;
  /** Ballpark share of sales per selected channel key, in percent. "" = not typed yet. */
  shares: Record<string, number | "">;
  fulfillment: string[];
  fulfillmentOther: string;
  longTermStock: string[];
  longTermStockOther: string;
  lotTracking: "" | "yes" | "no";
  lotTrackingTool: string;
  lotTrackingHow: string;
  ads: string[];
  adsOther: string;
  bookkeepingTool: string;
  bookkeeping: string;
  challenge: string;
};

export const EMPTY_ANSWERS: Answers = {
  fullName: "",
  companyName: "",
  brandUrl: "",
  email: "",
  phone: "",
  channels: [],
  channelOther: "",
  shares: {},
  fulfillment: [],
  fulfillmentOther: "",
  longTermStock: [],
  longTermStockOther: "",
  lotTracking: "",
  lotTrackingTool: "",
  lotTrackingHow: "",
  ads: [],
  adsOther: "",
  bookkeepingTool: "",
  bookkeeping: "",
  challenge: "",
};

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validEmail(v: string): boolean {
  return EMAIL_RE.test(v.trim());
}

export function validPhone(v: string): boolean {
  return v.replace(/\D/g, "").length >= 7;
}

/** The channel-mix total. Ballpark is the whole point, so anything near 100 passes. */
export function sharesTotal(a: Answers): number {
  return a.channels.reduce((sum, k) => sum + (typeof a.shares[k] === "number" ? (a.shares[k] as number) : 0), 0);
}

export function sharesComplete(a: Answers): boolean {
  if (a.channels.length <= 1) return true;
  if (!a.channels.every((k) => typeof a.shares[k] === "number")) return false;
  const t = sharesTotal(a);
  return t >= 90 && t <= 110;
}

/** Whether a multi-choice answer is complete: something picked, and "other" comes with its text. */
export function choiceComplete(keys: string[], other: string): boolean {
  if (keys.length === 0) return false;
  return !keys.includes("other") || other.trim().length > 0;
}

/** Toggle one key in a multi-choice list, honouring exclusive options. */
export function toggleChoice(list: Choice[], current: string[], key: string): string[] {
  const def = list.find((c) => c.key === key);
  if (current.includes(key)) return current.filter((k) => k !== key);
  if (def?.exclusive) return [key];
  return [...current.filter((k) => !list.find((c) => c.key === k)?.exclusive), key];
}

/** Human labels for a stored list, with "other" expanded to what they typed. */
export function labelsFor(list: Choice[], keys: string[], other: string): string[] {
  return keys.map((k) => (k === "other" && other.trim() ? `Other: ${other.trim()}` : list.find((c) => c.key === k)?.label ?? k));
}
