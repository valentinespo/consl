/** Currency + locale for money formatting. Defaults to USD so existing calls are unchanged;
 *  the app passes each org's own via the currency context (client) or getFmt (server).
 *  `code` is the ISO currency (USD, EUR, JPY…) — it decides symbol placement and how many
 *  decimal places the currency actually has. */
export type Currency = { symbol: string; locale: string; code?: string };
export const USD: Currency = { symbol: "$", locale: "en-US", code: "USD" };

/**
 * Money, formatted the way the org's own locale writes it.
 *
 * Concatenating a symbol in front of the number only works for currencies that lead with it:
 * a euro amount belongs after the number ("1.234,56 €"), and yen has no minor unit at all.
 * Intl knows all of that; fall back to concatenation only when no ISO code is configured.
 */
const fmtCache = new Map<string, Intl.NumberFormat>();
function currencyFormat(cur: Currency, dp: number | undefined): Intl.NumberFormat | null {
  if (!cur.code) return null;
  const key = `${cur.locale}|${cur.code}|${dp ?? "auto"}`;
  let f = fmtCache.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat(cur.locale, {
        style: "currency",
        currency: cur.code,
        ...(dp == null ? {} : { minimumFractionDigits: dp, maximumFractionDigits: dp }),
      });
    } catch {
      return null; // unknown locale or currency code — fall back below
    }
    fmtCache.set(key, f);
  }
  return f;
}

export const money = (n: number | null | undefined, dp: number | undefined = 2, cur: Currency = USD) => {
  if (n == null) return "—";
  const f = currencyFormat(cur, dp);
  if (f) return f.format(n);
  return (
    (n < 0 ? "-" : "") +
    cur.symbol +
    Math.abs(n).toLocaleString(cur.locale, { minimumFractionDigits: dp, maximumFractionDigits: dp })
  );
};

export const money0 = (n: number | null | undefined, cur: Currency = USD) => money(n, 0, cur);

/** Whole units, grouped for the org's locale (1,234 vs 1.234). */
export const qty = (n: number | null | undefined, cur: Currency = USD) =>
  n == null ? "—" : Math.round(n).toLocaleString(cur.locale);

/** Simple English pluralization for unit labels (bag→bags, pouch→pouches). */
export const plural = (w: string) => w + (/(s|x|z|ch|sh)$/i.test(w) ? "es" : "s");

/**
 * Unit labels that never take a plural: metric/imperial measures ("2.5 kg", never "kgs") and
 * count words that are already invariant ("12 each"). Matched case-insensitively on the whole
 * label, so a material counted in "bags" is unaffected.
 */
const INVARIANT_UNITS = new Set([
  // mass
  "kg", "g", "mg", "t", "lb", "lbs", "oz",
  // volume
  "l", "ml", "cl", "dl", "gal", "qt", "pt", "fl oz",
  // length / area / volume
  "m", "cm", "mm", "km", "in", "ft", "yd", "mi", "m2", "m3", "sq ft", "sqft", "sqm",
  // already-invariant count words
  "each", "ea", "pcs", "pc",
]);

/** Suggestions for the material unit-label picker — measures first, then common containers.
 *  A tenant can still type anything; this is only the shortlist. */
export const COMMON_UNIT_LABELS = [
  "unit", "each", "kg", "g", "lb", "oz", "L", "ml", "m", "cm", "ft", "in",
  "bag", "box", "case", "pallet", "roll", "sheet", "piece",
];

/**
 * A unit label written to agree with `count`: measures stay exactly as typed ("1 kg", "2.5 kg"),
 * countable nouns pluralise only above one ("1 bag", "15 bags"). Use this anywhere a label is
 * printed next to a number, so a tenant using "kg" never sees "kgs".
 */
export function inflectUnit(label: string | null | undefined, count: number): string {
  const l = (label ?? "").trim();
  if (!l) return "";
  if (INVARIANT_UNITS.has(l.toLowerCase())) return l;
  return Math.abs(count) === 1 ? l : plural(l);
}

export const perUnit = (n: number | null | undefined, cur: Currency = USD) => money(n, 2, cur);

/** Finer precision for sub-cent unit costs — a $0.004 label reads as $0.00 at two decimals. */
export const costFine = (n: number | null | undefined, cur: Currency = USD) => {
  if (n == null) return "—";
  const f = currencyFormat({ ...cur, code: cur.code }, undefined);
  if (f) {
    // Re-run with a wider fraction range; Intl keeps the currency's placement and symbol.
    try {
      return new Intl.NumberFormat(cur.locale, {
        style: "currency",
        currency: cur.code!,
        minimumFractionDigits: 2,
        maximumFractionDigits: 5,
      }).format(n);
    } catch {
      /* fall through */
    }
  }
  return cur.symbol + n.toLocaleString(cur.locale, { minimumFractionDigits: 2, maximumFractionDigits: 5 });
};

export const date = (d: Date | string | null | undefined, cur: Currency = USD) => {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  // Dates are stored as UTC-midnight date-only values; format in UTC so they don't
  // shift a day in non-UTC timezones.
  return dt.toLocaleDateString(cur.locale, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
};

/** SKU avatar colours for products without a photo: a violet scale, the app's own hue, picked by
 *  a stable hash of the code so a given product always wears the same shade. Lighter tints carry
 *  deep-violet lettering, deeper ones white. (Per-brand package colours used to live here — a
 *  tenant-agnostic app can't hardcode any one company's packaging.) */
export function skuColor(code: string): { bg: string; fg: string } {
  const palette = [
    { bg: "#ede9fe", fg: "#4c1d95" },
    { bg: "#ddd6fe", fg: "#4c1d95" },
    { bg: "#c4b5fd", fg: "#3b0764" },
    { bg: "#a78bfa", fg: "#ffffff" },
    { bg: "#8b5cf6", fg: "#ffffff" },
    { bg: "#7c3aed", fg: "#ffffff" },
  ];
  let h = 0;
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}
