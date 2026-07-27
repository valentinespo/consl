/**
 * The one place inventory buckets get their colour.
 *
 * The same five buckets are drawn as pills on the dashboard, as a stacked area under it, and as
 * the stock bar on every inventory row. They were three separate colour lists, which meant
 * recolouring one bucket was a hunt across three files and easy to leave half-done.
 */
// The four channel buckets are shades of one green, listed darkest first — that's the order they
// are drawn in on the row bar, so the bar reads as a single gradient rather than a jumble.
export const SEG = {
  awd: "#066629", // Amazon's upstream warehouse
  available: "#16a34a", // sellable at the channel
  inbound: "#4ade80", // on its way to the channel
  reserved: "#bbf7d0", // at the channel but spoken for
  locations: "#8b5cf6", // finished stock at your own facilities
  production: "#f59e0b", // being made
  raw: "#94a3b8", // materials, not yet a product
} as const;

/** Bottom → top of the stacked chart, and left → right of the value pills. */
export const BUCKETS = [
  { key: "fba", color: SEG.available, label: "FBA" },
  { key: "awd", color: SEG.awd, label: "AWD" },
  { key: "inProduction", color: SEG.production, label: "In production" },
  { key: "atLocations", color: SEG.locations, label: "At my locations" },
  { key: "raw", color: SEG.raw, label: "Raw materials" },
] as const;
