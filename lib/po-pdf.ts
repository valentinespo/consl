/**
 * Renders a Purchase Order PDF:
 * a header band (logo + title) flowing straight into the dark date/number bar, company/vendor
 * columns, items table with TOTAL. Supports "TBD" pricing (unitCost = null).
 * The sender block, colours and logo all come from the sending company's own profile — this
 * document goes to their suppliers, so nothing about it is hardcoded to one business.
 */
import path from "node:path";
import PDFDocument from "pdfkit";

export type PoPdfLine = { sku: string | null; description: string; unitCost: number | null; quantity: number };
/** The sending company, as stored on its Organization profile. */
export type PoPdfCompany = {
  name: string;
  addressLines: string[];
  email: string | null;
  phone: string | null;
  currencySymbol: string;
  currencyCode?: string;
  locale?: string;
  /** The company's own document colours. Defaults are neutral, not any one brand's. */
  brandInk?: string;
  brandBand?: string;
  /** The sender's own logo, as bytes. Absent = print the company name, never a bundled mark. */
  logo?: Buffer | null;
};
export type PoPdfData = {
  number: string; // "#21-CRW"
  dateISO: string; // "2026-07-05"
  vendorName: string;
  vendorAddress: string; // multiline
  lines: PoPdfLine[];
  company: PoPdfCompany;
};

const DEFAULT_INK = "#1f2937";
const DEFAULT_BAND = "#eef2f7";

const hex = (v: string | undefined, fallback: string) =>
  v && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim() : fallback;

/** Blend two colours; `t` is how far to move from `a` towards `b`. */
function mix(a: string, b: string, t: number): string {
  const ch = (c: string, i: number) => parseInt(c.slice(1 + i * 2, 3 + i * 2), 16);
  const out = [0, 1, 2].map((i) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t));
  return `#${out.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

/** Pull a colour toward its own brightness, draining saturation without changing how dark it is. */
function desaturate(c: string, t: number): string {
  const ch = (i: number) => parseInt(c.slice(1 + i * 2, 3 + i * 2), 16);
  const [r, g, b] = [ch(0), ch(1), ch(2)];
  const lum = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  const grey = `#${[lum, lum, lum].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  return mix(c, grey, t);
}

/** The full palette derived from the two colours a company picks.
 *
 * Body text is the ink lightened toward grey AND drained of saturation. Lightening alone keeps
 * the hue, which is fine for a muted brand but turns every line of an invoice vivid blue for a
 * saturated one — body copy shouldn't carry the brand, only the headings and bars should. */
function palette(c: PoPdfCompany) {
  const ink = hex(c.brandInk, DEFAULT_INK);
  const band = hex(c.brandBand, DEFAULT_BAND);
  return {
    ink,
    band,
    // Line items: keep the ink's darkness but almost all of its colour removed. A vivid brand
    // would otherwise print every row of the order in saturated colour, which is hard to read
    // and looks nothing like an invoice.
    body: desaturate(ink, 0.85),
    muted: desaturate(mix(ink, "#8a8f98", 0.45), 0.5),
    rule: mix(band, "#000000", 0.12),
  };
}

const L = 30; // band left
const R = 582; // band right
const IX = 62; // inner text left
const IR = 550; // inner text right

const FONT_TTC = path.join(process.cwd(), "lib", "fonts", "HelveticaNeue.ttc");

// This document is sent to the sender's own suppliers, so it must read in their conventions —
// their currency in the right position, their number grouping, their date order.
const loc = (c: PoPdfCompany) => c.locale || "en-US";

const fmtQty = (n: number, c: PoPdfCompany) => n.toLocaleString(loc(c), { maximumFractionDigits: 2 });

function fmtMoney(n: number, c: PoPdfCompany, maxFrac = 2): string {
  if (c.currencyCode) {
    try {
      return new Intl.NumberFormat(loc(c), {
        style: "currency",
        currency: c.currencyCode,
        minimumFractionDigits: 2,
        maximumFractionDigits: maxFrac,
      }).format(n);
    } catch {
      /* unknown code — fall through to the symbol form */
    }
  }
  return `${c.currencySymbol}  ${n.toLocaleString(loc(c), { minimumFractionDigits: 2, maximumFractionDigits: maxFrac })}`;
}

const fmtUnit = (n: number, c: PoPdfCompany) => fmtMoney(n, c, Math.abs(n) < 1 ? 4 : 2);
const fmtAmt = (n: number, c: PoPdfCompany) => fmtMoney(n, c, 2);

const fmtDate = (iso: string, c: PoPdfCompany) => {
  const [y, m, d] = iso.split("-");
  return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d))).toLocaleDateString(loc(c), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "UTC",
  });
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

  const { ink: INK, band: BAND, body: BODY, muted: MUTED, rule: ROW_RULE } = palette(data.company);

  // ---- Header: the company's band flowing straight into its dark bar (no gap) ----
  const bandTop = 55;
  const barY = 232; // band bottom == bar top
  const barH = 34;
  doc.rect(L, bandTop, R - L, barY - bandTop).fill(BAND);
  doc.rect(L, barY, R - L, barH).fill(INK);

  // The sender's own logo if they've uploaded one, otherwise their name set in type. Never a
  // bundled brand mark — this document goes out to the sender's suppliers under their name.
  let logoDrawn = false;
  if (data.company.logo) {
    try {
      doc.image(data.company.logo, IX, 84, { height: 34 });
      logoDrawn = true;
    } catch {
      logoDrawn = false;
    }
  }
  if (!logoDrawn) doc.font("Bold").fontSize(26).fillColor(INK).text(data.company.name, IX, 84);
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
  doc.text(`PO DATE: ${fmtDate(data.dateISO, data.company)}`, IX, barTextY, { characterSpacing: 0.3 });
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
    doc.font("Body").fontSize(9.5).fillColor(BODY);
    const descH = doc.heightOfString(line.description, { width: DESC_W, lineGap: 2 });
    const rowH = Math.max(32, descH + 18);
    const textY = y + (rowH - descH) / 2;
    doc.font("Med").text(line.sku ?? "—", SKU_X, y + (rowH - 11) / 2, { width: SKU_W });
    doc.font("Body").text(line.description, DESC_X, textY, { width: DESC_W, lineGap: 2 });
    const midY = y + (rowH - 11) / 2;
    if (line.unitCost == null) {
      doc.text("TBD", UNIT_R - 90, midY, { width: 90, align: "right" });
      doc.text(fmtQty(line.quantity, data.company), QTY_R - 55, midY, { width: 55, align: "right" });
      doc.text("TBD", AMT_R - 90, midY, { width: 90, align: "right" });
    } else {
      doc.text(fmtUnit(line.unitCost, data.company), UNIT_R - 90, midY, { width: 90, align: "right" });
      doc.text(fmtQty(line.quantity, data.company), QTY_R - 55, midY, { width: 55, align: "right" });
      doc.text(fmtAmt(line.unitCost * line.quantity, data.company), AMT_R - 90, midY, { width: 90, align: "right" });
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
  doc.text(total == null ? "TBD" : fmtAmt(total, data.company), AMT_R - 130, y, { width: 130, align: "right" });

  doc.end();
  return done;
}
