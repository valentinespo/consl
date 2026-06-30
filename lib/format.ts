export const money = (n: number | null | undefined, dp = 2) =>
  n == null
    ? "—"
    : (n < 0 ? "-$" : "$") +
      Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

export const money0 = (n: number | null | undefined) => money(n, 0);

export const qty = (n: number | null | undefined) =>
  n == null ? "—" : Math.round(n).toLocaleString("en-US");

/** Simple English pluralization for unit labels (bag→bags, pouch→pouches). */
export const plural = (w: string) => w + (/(s|x|z|ch|sh)$/i.test(w) ? "es" : "s");

export const perUnit = (n: number | null | undefined) =>
  n == null ? "—" : "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Finer precision for sub-cent unit costs (e.g. tea-bag per-bag cost). */
export const costFine = (n: number | null | undefined) =>
  n == null ? "—" : "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 5 });

export const date = (d: Date | string | null | undefined) => {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  // Dates are stored as UTC-midnight date-only values; format in UTC so they don't
  // shift a day in non-UTC timezones.
  return dt.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
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
