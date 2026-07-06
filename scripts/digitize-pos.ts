/**
 * One-time digitization of historical PO line items from the archived PDFs.
 * Parses each imported PO's PDF text into lines (SKU-mapped by description keywords),
 * stores them as PurchaseOrderLine rows, and recomputes the PO total. Idempotent:
 * skips POs that already have lines.
 *
 * pdf-parse text glues columns together ("...Pouches2.79$  405014,053.50$"), so amounts
 * are recovered by an arithmetic split: the qty/amount boundary where unit×qty ≈ amount.
 *
 * Usage: node --import tsx scripts/digitize-pos.ts
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../lib/prisma";
import { poTotal } from "../lib/po-pdf";

const SKU_KEYWORDS: [RegExp, string][] = [
  [/calm/i, "CLM"],
  [/relax|sleep/i, "SLP"],
  [/mushroom|brain/i, "MBB"],
  [/liver|kidney/i, "LKD"],
  [/lung|mullein/i, "LDX"],
  [/hormone/i, "WHB"],
  [/yerba|mate\b/i, "YBM"],
];

type Parsed = { description: string; unitCost: number | null; quantity: number };

const num = (s: string) => Number(s.replace(/,/g, ""));

/** Split a glued "qty amount" blob using unit×qty ≈ amount. */
function arithmeticSplit(blob: string, unit: number): { qty: number; amount: number } | null {
  for (let i = 1; i < blob.length; i++) {
    const qtyStr = blob.slice(0, i);
    const amtStr = blob.slice(i);
    if (!/^[\d,]+$/.test(qtyStr) || !/^[\d,]+(\.\d+)?$/.test(amtStr)) continue;
    const qty = num(qtyStr);
    const amt = num(amtStr);
    if (qty > 0 && Math.abs(unit * qty - amt) < 0.51) return { qty, amount: amt };
  }
  return null;
}

function parseLines(text: string): { lines: Parsed[]; leftovers: string[] } {
  const rows = text.split("\n").map((l) => l.trim());
  const start = rows.findIndex((l) => /^ITEM DESCRIPTION/.test(l));
  const end = rows.findIndex((l) => /^TOTAL/.test(l));
  const body = rows.slice(start + 1, end === -1 ? undefined : end).filter((l) => l && !/^UNIT COST/.test(l));
  const lines: Parsed[] = [];
  const leftovers: string[] = [];

  for (const row of body) {
    // TBD-priced: "DescriptionTBD280              TBD"
    let m = row.match(/^(.+?)\s*TBD\s*([\d,]+)\s*TBD\s*$/);
    if (m) {
      lines.push({ description: m[1].trim(), unitCost: null, quantity: num(m[2]) });
      continue;
    }
    // Priced: "Description<unit>$  <qty> <amount>$" (qty/amount possibly glued)
    m = row.match(/^(.+?)([\d.,]+)\$\s*(.+?)\$?\s*$/);
    if (m) {
      const description = m[1].trim();
      const unit = num(m[2]);
      const rest = m[3].replace(/\$/g, "").trim();
      if (/^[\d,]+\s+TBD$/i.test(rest)) {
        lines.push({ description, unitCost: unit, quantity: num(rest.split(/\s+/)[0]) });
        continue;
      }
      const parts = rest.split(/\s+/);
      if (parts.length === 2) {
        lines.push({ description, unitCost: unit, quantity: num(parts[0]) });
        continue;
      }
      const split = arithmeticSplit(rest.replace(/\s+/g, ""), unit);
      if (split) {
        lines.push({ description, unitCost: unit, quantity: split.qty });
        continue;
      }
    }
    leftovers.push(row);
  }
  return { lines, leftovers };
}

async function main() {
  const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default;
  const products = await prisma.product.findMany();
  const byCode = new Map(products.map((p) => [p.code, p.id]));

  const pos = await prisma.purchaseOrder.findMany({
    where: { imported: true, pdfUrl: { not: null } },
    include: { lines: true },
    orderBy: { date: "asc" },
  });

  for (const po of pos) {
    if (po.lines.length > 0) {
      console.log(`= ${po.number}: already digitized, skipping`);
      continue;
    }
    const file = path.join(process.cwd(), "public", po.pdfUrl!);
    const { text } = await pdfParse(await readFile(file));
    const { lines, leftovers } = parseLines(text);
    if (lines.length === 0) {
      console.warn(`⚠ ${po.number}: no lines parsed. leftovers:`, leftovers);
      continue;
    }
    for (const l of leftovers) console.warn(`  ⚠ ${po.number} unparsed row: ${JSON.stringify(l)}`);

    await prisma.purchaseOrderLine.createMany({
      data: lines.map((l, i) => {
        const skuCode = SKU_KEYWORDS.find(([re]) => re.test(l.description))?.[1] ?? null;
        return {
          poId: po.id,
          seq: i,
          kind: skuCode ? "SKU" : "FEE",
          productId: skuCode ? (byCode.get(skuCode) ?? null) : null,
          description: l.description,
          unitCost: l.unitCost,
          quantity: l.quantity,
          lotUnits: null,
        };
      }),
    });
    const total = poTotal(lines);
    await prisma.purchaseOrder.update({ where: { id: po.id }, data: { total } });
    console.log(
      `✓ ${po.number}: ${lines.length} lines — ${lines
        .map((l) => {
          const sku = SKU_KEYWORDS.find(([re]) => re.test(l.description))?.[1] ?? "FEE";
          return `${sku} ${l.unitCost == null ? "TBD" : "$" + l.unitCost}×${l.quantity}`;
        })
        .join(", ")} | total: ${total == null ? "TBD" : "$" + total.toLocaleString("en-US")}`,
    );
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
