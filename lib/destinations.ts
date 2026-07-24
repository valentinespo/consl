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

export function destinationLabel(value: string | null): string {
  return DESTINATIONS.find((d) => d.value === value)?.label ?? value ?? "—";
}
