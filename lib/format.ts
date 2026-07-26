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

/**
 * Package colors per SKU — update these hexes to match the real packaging.
 * (Best-guess placeholders until confirmed.)
 */
export const SKU_COLORS: Record<string, string> = {
  SLP: "#8b7cc0", // Relax & Sleep — lavender
  CLM: "#8fbf6a", // Calm & Stress Relief — green
  LKD: "#2f6b3a", // Liver & Kidney Detox — forest green
  LDX: "#b2bd44", // Mullein Lung Detox — yellow-green
  MBB: "#a86a3a", // Mushroom — orange-brown
  WHB: "#d488a6", // Hormone Balance — rose
  YBM: "#73c6b6", // Yerba Mate — aquamarine
};

function luminance(hex: string): number {
  const c = hex.replace("#", "");
  const ch = (i: number) => parseInt(c.slice(i, i + 2), 16) / 255;
  const lin = (x: number) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(ch(0)) + 0.7152 * lin(ch(2)) + 0.0722 * lin(ch(4));
}

/** Pick whichever of dark-green / white text has the higher contrast on the given background. */
function readableText(hex: string): string {
  const L = luminance(hex);
  const contrastWhite = 1.05 / (L + 0.05);
  const contrastDark = (L + 0.05) / (luminance("#1a2f18") + 0.05);
  return contrastDark >= contrastWhite ? "#1a2f18" : "#ffffff";
}

/** SKU avatar color — from the package-color map, with a sage fallback. */
export function skuColor(code: string): { bg: string; fg: string } {
  const hex = SKU_COLORS[code];
  if (hex) return { bg: hex, fg: readableText(hex) };
  const palette = [
    { bg: "#d9e5ba", fg: "#1a2f18" },
    { bg: "#c7dca0", fg: "#1a2f18" },
    { bg: "#cbd9b4", fg: "#1a2f18" },
    { bg: "#b9cd8e", fg: "#1a2f18" },
  ];
  let h = 0;
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}
