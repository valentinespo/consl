/** A single per-unit cost component shown on a lot line — either a material (from the FIFO
 *  recipe) or a transaction category. Fully data-driven: no material or category is special-cased. */
export type CostChip = { label: string; value: number; short?: boolean };

function parseObj(json: string): Record<string, number> {
  try {
    const o = JSON.parse(json);
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}
function parseArr(json: string): { materialCode: string }[] {
  try {
    const a = JSON.parse(json);
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

/** Build the per-unit cost breakdown for a lot line: material costs (labelled by material name)
 *  followed by transaction-category costs. `matName` maps a material code to its display name. */
export function buildCostChips(
  materialCostsJson: string,
  transactionCostsJson: string,
  shortfallsJson: string,
  matName: (code: string) => string,
): CostChip[] {
  const mats = parseObj(materialCostsJson);
  const txns = parseObj(transactionCostsJson);
  const short = new Set(parseArr(shortfallsJson).map((s) => s.materialCode));
  const chips: CostChip[] = [];
  for (const [code, v] of Object.entries(mats)) {
    if (Math.abs(v) > 1e-7 || short.has(code)) chips.push({ label: matName(code), value: v, short: short.has(code) });
  }
  for (const [cat, v] of Object.entries(txns)) {
    if (Math.abs(v) > 1e-7) chips.push({ label: cat, value: v });
  }
  return chips;
}
