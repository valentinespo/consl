/** The kinds of place inventory can live. A facility is wherever stock sits or is produced —
 *  your co-packer, your own warehouse, or a 3PL you simply ship to and never visit.
 *  Deliberately not enforced anywhere: the type is a label, so no picker is ever restricted by it. */
export const FACILITY_TYPES = [
  { value: "co-packer", label: "Co-packer", hint: "Packs or blends your product for you" },
  { value: "manufacturer", label: "Manufacturer", hint: "Makes your product from scratch" },
  { value: "warehouse", label: "Warehouse", hint: "A storage location you run yourself" },
  { value: "3pl", label: "3PL", hint: "Third-party logistics you ship stock to" },
  { value: "other", label: "Other", hint: "Anywhere else your stock sits" },
] as const;

export type FacilityType = (typeof FACILITY_TYPES)[number]["value"];

/** Places where product is actually made — the only ones that have production lots and POs.
 *  A warehouse or 3PL just holds stock, so lot/purchase/PO counts are meaningless there. */
const PRODUCTION_TYPES = new Set(["co-packer", "manufacturer"]);

export function isProductionSite(type: string): boolean {
  return PRODUCTION_TYPES.has(type);
}

export function facilityTypeLabel(value: string): string {
  return FACILITY_TYPES.find((t) => t.value === value)?.label ?? value;
}
