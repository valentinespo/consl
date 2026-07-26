/**
 * One-time import of historical POs from the Google Drive archive.
 * For each lot with a poNumber, looks for  <DRIVE>/PO #N-FAC/PO #N-FAC.pdf,
 * copies it into public/uploads/po/, extracts the printed TOTAL, and upserts a
 * PurchaseOrder record (status SENT, no digitized lines). Idempotent.
 *
 * Usage: node --import tsx scripts/import-pos.ts
 */
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { prisma } from "../../lib/prisma";

const DRIVE = "/Users/valentinesposito/Library/CloudStorage/GoogleDrive-valentinespo1@gmail.com/Shared drives/Herbl/PO:Invoices";
const OUT = path.join(process.cwd(), "public", "uploads", "po");

async function extractTotal(pdfPath: string): Promise<number | null> {
  try {
    // Import the lib file directly — the package root runs debug code under some loaders.
    const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default;
    const { text } = await pdfParse(await readFile(pdfPath));
    if (/TOTAL\s*TBD/i.test(text)) return null;
    const m = text.match(/TOTAL\s*\$?\s*([\d,]+(?:\.\d+)?)/i);
    return m ? Number(m[1].replace(/,/g, "")) : null;
  } catch (e) {
    console.warn(`   (could not parse total: ${(e as Error).message.slice(0, 60)})`);
    return null;
  }
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const lots = await prisma.lot.findMany({ where: { poNumber: { not: null } }, orderBy: { lotNr: "asc" } });
  let created = 0;
  let updated = 0;
  let noPdf = 0;

  for (const lot of lots) {
    // Normalize the odd "#9.STC" sheet typo to the standard "#9-STC" form.
    const number = lot.poNumber!.replace(/\.(?=[A-Z]{3}$)/, "-");
    if (number !== lot.poNumber) await prisma.lot.update({ where: { id: lot.id }, data: { poNumber: number } });
    const folder = path.join(DRIVE, `PO ${number}`);
    const src = path.join(folder, `PO ${number}.pdf`);
    let pdfUrl: string | null = null;
    let total: number | null = null;

    if (existsSync(src)) {
      const outName = `PO-${number.replace(/[^A-Za-z0-9-]+/g, "")}.pdf`;
      await copyFile(src, path.join(OUT, outName));
      pdfUrl = `/uploads/po/${outName}`;
      total = await extractTotal(src);
    } else {
      noPdf++;
      console.warn(`⚠ no PDF for ${number} (${existsSync(folder) ? "folder exists, file missing" : "no folder"})`);
    }

    const data = {
      number,
      date: lot.poDate ?? lot.createdAt,
      status: "SENT",
      facilityId: lot.facilityId,
      lotId: lot.id,
      pdfUrl,
      total,
      imported: true,
    };
    const existing = await prisma.purchaseOrder.findUnique({ where: { number } });
    if (existing) {
      // Never clobber a PO that was created (with lines) in the app.
      const lineCount = await prisma.purchaseOrderLine.count({ where: { poId: existing.id } });
      if (lineCount > 0) continue;
      await prisma.purchaseOrder.update({ where: { number }, data });
      updated++;
    } else {
      await prisma.purchaseOrder.create({ data });
      created++;
    }
    console.log(`✓ ${number}  total=${total == null ? "—" : `$${total.toLocaleString("en-US")}`}  pdf=${pdfUrl ? "yes" : "MISSING"}`);
  }

  console.log(`\nDone: ${created} created, ${updated} updated, ${noPdf} without PDF, ${lots.length} lots scanned.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
