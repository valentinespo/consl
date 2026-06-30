/**
 * M2 trust checkpoint: parse the sheet, run the engine, diff every lot line's
 * computed costs (TEA / T-BAG / POUCH / OTHER / COG) against the spreadsheet's values.
 * No database involved.
 */
import path from "node:path";
import { parseWorkbook } from "../lib/xlsx-source";
import {
  runEngine,
  type EnginePurchase,
  type EngineLotLine,
  type EngineTransaction,
} from "../lib/fifo";

const XLSX = path.resolve(process.cwd(), "../Lots, Inventory & Purchases.xlsx");

function buildInputs(src: Awaited<ReturnType<typeof parseWorkbook>>) {
  const purchases: EnginePurchase[] = src.purchases.map((p) => ({
    materialCode: p.materialCode,
    facility: p.facility,
    sku: p.materialCode === "POUCH" ? p.sku : null,
    date: p.date,
    seq: p.seq,
    quantity: p.quantity,
    unitCost: p.unitCost,
    isAdjustment: p.isAdjustment,
  }));

  const lines: EngineLotLine[] = [];
  for (const lot of src.lots) {
    for (const ln of lot.lines) {
      const materials = [
        { materialCode: "POUCH", poolKey: "FACILITY_SKU" as const, perUnit: 1, poolSku: ln.sku },
      ];
      if (ln.sheetTbag > 0) {
        materials.push({
          materialCode: "TEABAG",
          poolKey: "FACILITY" as const,
          perUnit: 15,
          poolSku: null as unknown as string,
        });
      }
      lines.push({
        key: `${lot.lotNr}:${ln.sku}:${ln.seq}`,
        lotNr: lot.lotNr,
        poDate: lot.poDate ?? 0,
        seq: ln.seq,
        facility: lot.facility,
        sku: ln.sku,
        units: ln.units,
        materials,
      });
    }
  }

  const transactions: EngineTransaction[] = src.transactions.map((t) => ({
    lotNr: t.lotNr,
    category: t.category === "TEA" ? "TEA" : "OTHER",
    applicable: t.applicable,
    sku: t.skus,
    appliesToCog: t.appliesToCog,
  }));

  return { purchases, lines, transactions };
}

async function main() {
  const src = await parseWorkbook(XLSX);
  console.log(
    `Parsed: ${src.lots.length} lots, ${src.lots.reduce((s, l) => s + l.lines.length, 0)} lines, ` +
      `${src.purchases.length} purchases, ${src.transactions.length} transactions, ${src.suppliers.length} suppliers.`,
  );

  const { purchases, lines, transactions } = buildInputs(src);
  const result = runEngine(purchases, lines, transactions);

  const TOL = 0.01; // 1 cent / per-unit tolerance
  type Row = {
    lot: number;
    sku: string;
    field: string;
    sheet: number;
    engine: number;
    diff: number;
  };
  const bad: Row[] = [];
  let checked = 0;

  for (const lot of src.lots) {
    for (const ln of lot.lines) {
      const key = `${lot.lotNr}:${ln.sku}:${ln.seq}`;
      const lc = result.lines.get(key)!;
      const cmp: [string, number, number][] = [
        ["TEA", ln.sheetTea, lc.teaCostPerUnit],
        ["TBAG", ln.sheetTbag, lc.materialCostsPerUnit["TEABAG"] ?? 0],
        ["POUCH", ln.sheetPouch, lc.materialCostsPerUnit["POUCH"] ?? 0],
        ["OTHER", ln.sheetOther, lc.otherCostPerUnit],
        ["COG", ln.sheetCog, lc.cogPerUnit],
      ];
      for (const [field, sheet, engine] of cmp) {
        checked++;
        const diff = Math.abs(sheet - engine);
        if (diff > TOL) bad.push({ lot: lot.lotNr, sku: ln.sku, field, sheet, engine, diff });
      }
    }
  }

  console.log(`\nChecked ${checked} values. Mismatches > ${TOL}: ${bad.length}`);
  if (bad.length) {
    bad.sort((a, b) => b.diff - a.diff);
    console.log("\nWorst 30 mismatches:");
    console.log("LOT  SKU   FIELD  SHEET        ENGINE       DIFF");
    for (const b of bad.slice(0, 30)) {
      console.log(
        `${String(b.lot).padEnd(4)} ${b.sku.padEnd(5)} ${b.field.padEnd(6)} ` +
          `${b.sheet.toFixed(5).padStart(11)} ${b.engine.toFixed(5).padStart(11)} ${b.diff.toFixed(5).padStart(10)}`,
      );
    }
    // field-level summary
    const byField = new Map<string, number>();
    for (const b of bad) byField.set(b.field, (byField.get(b.field) ?? 0) + 1);
    console.log("\nMismatches by field:", Object.fromEntries(byField));
  } else {
    console.log("✅ All line costs match the spreadsheet within tolerance.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
