/**
 * The one place inventory buckets get their colour.
 *
 * The same buckets are drawn as pills on the dashboard, as a stacked area under it, and as the
 * stock bar on every inventory row. They were three separate colour lists, which meant recolouring
 * one bucket was a hunt across three files and easy to leave half-done.
 *
 * Channel buckets wear their channel's brand colour so the split reads at a glance: Amazon stock
 * in Amazon orange (AWD the darker shade), Shopify in Shopify green, TikTok in TikTok's fuchsia.
 */
// The four Amazon buckets are shades of one orange, listed darkest first — that's the order they
// are drawn in on the row bar, so the bar reads as a single gradient rather than a jumble.
export const SEG = {
  awd: "#b45309", // Amazon's upstream warehouse — the darker orange
  available: "#ff9900", // sellable at Amazon — Amazon's own orange
  inbound: "#ffc266", // on its way to the channel
  reserved: "#ffe3bd", // at the channel but spoken for
  shopify: "#95bf47", // Shopify's brand green
  tiktok: "#fe2c55", // TikTok's brand fuchsia
  locations: "#2563eb", // finished stock at your own facilities — the old app blue, kept as its own hue
  production: "#8b5cf6", // being made — the dashboard's violet (matches the "In production" theme)
  raw: "#94a3b8", // materials, not yet a product
} as const;

/** Bottom → top of the stacked chart, and left → right of the value pills.
 *  `channel` gates visibility: a channel bucket only shows while that platform is connected. */
export const BUCKETS = [
  { key: "fba", color: SEG.available, label: "FBA", channel: "amazon" },
  { key: "awd", color: SEG.awd, label: "AWD", channel: "amazon" },
  { key: "shopify", color: SEG.shopify, label: "Shopify", channel: "shopify" },
  { key: "tiktok", color: SEG.tiktok, label: "TikTok", channel: "tiktok" },
  { key: "inProduction", color: SEG.production, label: "In production", channel: null },
  { key: "atLocations", color: SEG.locations, label: "At my locations", channel: null },
  { key: "raw", color: SEG.raw, label: "Raw materials", channel: null },
] as const;

/** The buckets to show for a given set of connected providers (e.g. ["amazon","shopify"]). */
export function bucketsFor(connected: string[]) {
  return BUCKETS.filter((b) => b.channel === null || connected.includes(b.channel));
}
