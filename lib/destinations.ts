/** Where finished stock can go when it leaves one of your own locations.
 *  Transfers to another of your facilities are handled separately (they keep the stock yours). */
export const DESTINATIONS = [
  { value: "AMAZON", label: "Amazon (FBA / AWD)", hint: "Amazon's own reported stock takes over from here" },
  { value: "SHOPIFY", label: "Shopify fulfilment", hint: "Handed to your Shopify fulfilment location" },
  { value: "TIKTOK", label: "TikTok Shop fulfilment", hint: "Handed to your TikTok fulfilment location" },
  { value: "CUSTOMER", label: "Sold / shipped to customer", hint: "Straight to a customer — wholesale, bulk, samples" },
  { value: "LOSS", label: "Lost / damaged (write-off)", hint: "Stock that disappeared — lowers inventory, no sale" },
] as const;

export type Destination = (typeof DESTINATIONS)[number]["value"];

/** Where RAW materials can go: only another facility (a transfer) or written off. Raw materials
 *  are never sold or fulfilled through a channel — only finished product is. */
export const RAW_DESTINATIONS = DESTINATIONS.filter((d) => d.value === "LOSS");

/** Destinations a given item kind may leave inventory through (transfers are handled separately). */
export function allowedDestinations(itemType: string): readonly string[] {
  return (itemType === "RAW" ? RAW_DESTINATIONS : DESTINATIONS).map((d) => d.value);
}

export function destinationLabel(value: string | null): string {
  return DESTINATIONS.find((d) => d.value === value)?.label ?? value ?? "—";
}
