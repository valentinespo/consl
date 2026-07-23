/**
 * Renders a Purchase Order PDF:
 * sage header band (logo + title) flowing straight into the dark date/number bar,
 * company/vendor columns, items table with TOTAL. Supports "TBD" pricing (unitCost = null).
 * The sender block comes from the signed-in company's profile, not a hardcoded constant.
 */
import path from "node:path";
import PDFDocument from "pdfkit";

export type PoPdfLine = { sku: string | null; description: string; unitCost: number | null; quantity: number };
/** The sending company, as stored on its Organization profile. */
export type PoPdfCompany = { name: string; addressLines: string[]; email: string | null; phone: string | null; currencySymbol: string };
export type PoPdfData = {
  number: string; // "#21-CRW"
  dateISO: string; // "2026-07-05"
  vendorName: string;
  vendorAddress: string; // multiline
  lines: PoPdfLine[];
  company: PoPdfCompany;
};

const INK = "#1a2f18"; // brand ink — all dark greens
const BAND = "#dfe9d0"; // light sage header
const MUTED = "#42513c"; // body text on light backgrounds
const ROW_RULE = "#d8e0cc";

const L = 30; // band left
const R = 582; // band right
const IX = 62; // inner text left
const IR = 550; // inner text right

const FONT_TTC = path.join(process.cwd(), "lib", "fonts", "HelveticaNeue.ttc");

const fmtQty = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const fmtUnit = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: Math.abs(n) < 1 ? 4 : 2 });
const fmtAmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
};

export function poTotal(lines: Pick<PoPdfLine, "unitCost" | "quantity">[]): number | null {
  if (lines.some((l) => l.unitCost == null)) return null;
  return lines.reduce((s, l) => s + (l.unitCost ?? 0) * l.quantity, 0);
}

export async function generatePoPdf(data: PoPdfData): Promise<Buffer> {
  const doc = new PDFDocument({ size: "LETTER", margins: { top: 0, bottom: 40, left: 0, right: 0 } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  // Helvetica Neue faces from the bundled collection (built-in Helvetica as fallback).
  try {
    doc.registerFont("Body", FONT_TTC, "HelveticaNeue");
    doc.registerFont("Med", FONT_TTC, "HelveticaNeue-Medium");
    doc.registerFont("Bold", FONT_TTC, "HelveticaNeue-Bold");
  } catch {
    doc.registerFont("Body", "Helvetica");
    doc.registerFont("Med", "Helvetica-Bold");
    doc.registerFont("Bold", "Helvetica-Bold");
  }

  // ---- Header: sage band flowing straight into the dark bar (no gap) ----
  const bandTop = 55;
  const barY = 232; // band bottom == bar top
  const barH = 34;
  doc.rect(L, bandTop, R - L, barY - bandTop).fill(BAND);
  doc.rect(L, barY, R - L, barH).fill(INK);

  try {
    doc.image(path.join(process.cwd(), "public", "brand", "logo.png"), IX, 84, { height: 34 });
  } catch {
    doc.font("Bold").fontSize(26).fillColor(INK).text(data.company.name, IX, 84);
  }
  doc.font("Bold").fontSize(22).fillColor(INK).text("PURCHASE ORDER", IX, 92, { width: IR - IX, align: "right", characterSpacing: 0.5 });

  // Company / vendor columns
  const colY = 152;
  const label = (t: string, x: number, y: number) => doc.font("Bold").fontSize(8.5).fillColor(INK).text(t, x, y, { characterSpacing: 0.2 });
  const value = (t: string, x: number, y: number, w: number) =>
    doc.font("Body").fontSize(9.5).fillColor(MUTED).text(t, x, y, { width: w, lineGap: 3 });

  label("Address", IX, colY);
  value(data.company.addressLines.join("\n"), IX, colY + 14, 175);
  label("Email", IX + 190, colY);
  value(data.company.email ?? "", IX + 190, colY + 14, 140);
  label("Phone", IX + 190, colY + 31);
  value(data.company.phone ?? "", IX + 190, colY + 45, 140);
  label("Vendor", IX + 330, colY);
  value(`${data.vendorName}\n${data.vendorAddress}`, IX + 330, colY + 14, IR - (IX + 330));

  // Dark bar text
  doc.font("Bold").fontSize(11).fillColor("#ffffff");
  const barTextY = barY + (barH - 11) / 2 - 1;
  doc.text(`PO DATE: ${fmtDate(data.dateISO)}`, IX, barTextY, { characterSpacing: 0.3 });
  doc.text(`PURCHASE ORDER ${data.number}`, IX, barTextY, { width: IR - IX, align: "right", characterSpacing: 0.3 });

  // ---- Items table ----
  const SKU_X = IX;
  const SKU_W = 42;
  const DESC_X = IX + SKU_W + 12;
  const DESC_W = 240;
  const UNIT_R = 425;
  const QTY_R = 483;
  const AMT_R = IR;

  let y = barY + barH + 34;
  doc.font("Bold").fontSize(9).fillColor(INK);
  doc.text("SKU", SKU_X, y, { characterSpacing: 0.4 });
  doc.text("ITEM DESCRIPTION", DESC_X, y, { characterSpacing: 0.4 });
  doc.text("UNIT COST", UNIT_R - 90, y, { width: 90, align: "right", characterSpacing: 0.4 });
  doc.text("QTY", QTY_R - 55, y, { width: 55, align: "right", characterSpacing: 0.4 });
  doc.text("AMOUNT", AMT_R - 90, y, { width: 90, align: "right", characterSpacing: 0.4 });
  y += 17;
  doc.moveTo(SKU_X, y).lineTo(IR, y).lineWidth(1).strokeColor(INK).stroke();
  y += 5;

  for (const line of data.lines) {
    doc.font("Body").fontSize(9.5).fillColor(INK);
    const descH = doc.heightOfString(line.description, { width: DESC_W, lineGap: 2 });
    const rowH = Math.max(32, descH + 18);
    const textY = y + (rowH - descH) / 2;
    doc.font("Med").text(line.sku ?? "—", SKU_X, y + (rowH - 11) / 2, { width: SKU_W });
    doc.font("Body").text(line.description, DESC_X, textY, { width: DESC_W, lineGap: 2 });
    const midY = y + (rowH - 11) / 2;
    if (line.unitCost == null) {
      doc.text("TBD", UNIT_R - 90, midY, { width: 90, align: "right" });
      doc.text(fmtQty(line.quantity), QTY_R - 55, midY, { width: 55, align: "right" });
      doc.text("TBD", AMT_R - 90, midY, { width: 90, align: "right" });
    } else {
      doc.text(`$  ${fmtUnit(line.unitCost)}`, UNIT_R - 90, midY, { width: 90, align: "right" });
      doc.text(fmtQty(line.quantity), QTY_R - 55, midY, { width: 55, align: "right" });
      doc.text(`$  ${fmtAmt(line.unitCost * line.quantity)}`, AMT_R - 90, midY, { width: 90, align: "right" });
    }
    y += rowH;
    doc.moveTo(SKU_X, y).lineTo(IR, y).lineWidth(0.6).strokeColor(ROW_RULE).stroke();
    y += 5;
  }

  // ---- Total ----
  y += 20;
  doc.moveTo(UNIT_R - 90, y).lineTo(IR, y).lineWidth(0.6).strokeColor(ROW_RULE).stroke();
  y += 14;
  const total = poTotal(data.lines);
  doc.font("Bold").fontSize(11).fillColor(INK);
  doc.text("TOTAL", UNIT_R - 90, y, { characterSpacing: 0.4 });
  doc.text(total == null ? "TBD" : `$  ${fmtAmt(total)}`, AMT_R - 130, y, { width: 130, align: "right" });

  doc.end();
  return done;
}
