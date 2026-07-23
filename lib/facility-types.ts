/** The kinds of place inventory can live. A facility is wherever stock sits or is produced —
 *  your co-packer, your own warehouse, or a 3PL you simply ship to and never visit.
 *  Deliberately not enforced anywhere: the type is a label, so no picker is ever restricted by it. */
export const FACILITY_TYPES = [
  { value: "co-packer", label: "Co-packer", hint: "Manufactures your product for you" },
  { value: "warehouse", label: "Warehouse", hint: "A storage location you run yourself" },
  { value: "3pl", label: "3PL", hint: "Third-party logistics you ship stock to" },
  { value: "other", label: "Other", hint: "Anywhere else your stock sits" },
] as const;

export type FacilityType = (typeof FACILITY_TYPES)[number]["value"];

export function facilityTypeLabel(value: string): string {
  return FACILITY_TYPES.find((t) => t.value === value)?.label ?? value;
}
