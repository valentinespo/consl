/**
 * Parses the source spreadsheet into invoice-grouped records for import.
 * Invoices are detected from the sheet's MERGED cells:
 *   - PO Transactions: column E (Invoice amount) merges group rows into one payment.
 *   - Purchases (packaging): column C (Invoice total) merges group rows; tea bags are 1-per-row.
 */
import ExcelJS from "exceljs";

export const FACILITY_NAMES: Record<string, string> = {
  STC: "SpecialTea Company",
  CCP: "Custom Co-Pak",
  CRW: "Caraway",
};

export const PRODUCT_NAMES: Record<string, string> = {
  CLM: "Calm & Stress Relief Tea",
  LDX: "Mullein Lung Detox Tea",
  LKD: "Liver and Kidney Detox Tea",
  MBB: "Mushroom Tea",
  SLP: "Relax & Sleep Tea",
  WHB: "Hormone Balance Tea",
  YBM: "Yerba Mate Tea",
};

export interface SrcLotLine {
  sku: string;
  units: number;
  status: "IN_PRODUCTION" | "FINISHED";
  sheetTea: number;
  sheetTbag: number;
  sheetPouch: number;
  sheetOther: number;
  sheetCog: number;
  sheetInbound: number;
  seq: number;
}
export interface SrcLot {
  poNumber: string | null;
  lotNr: number;
  poDate: number | null;
  poDateISO: string | null;
  facility: string;
  notes: string | null;
  lines: SrcLotLine[];
  inboundTxns: SrcInboundTxn[]; // INBOUND (Amazon FBA/AWD) — excluded from COG, summarised in notes
}

export interface SrcInboundTxn {
  amount: number;
  concept: string | null;
  supplier: string | null;
}

export interface SrcTxnLine {
  lotNr: number | null;
  category: "TEA" | "OTHER" | "NOT_APPLICABLE";
  amount: number;
  sku: string | null;
  concept: string | null;
  appliesToCog: boolean;
}
export interface SrcTransactionInvoice {
  supplier: string | null;
  date: number | null;
  dateISO: string | null;
  invoiceTotal: number;
  lines: SrcTxnLine[];
}

export interface SrcPurchaseLine {
  facility: string;
  sku: string | null;
  quantity: number;
  unitCost: number;
  total: number;
  isAdjustment: boolean;
  seq: number;
}
export interface SrcPurchaseInvoice {
  supplier: string | null;
  date: number;
  dateISO: string;
  materialCode: "TEABAG" | "POUCH";
  invoiceTotal: number;
  isAdjustment: boolean;
  notes: string | null;
  lines: SrcPurchaseLine[];
}

export interface SrcData {
  facilities: { code: string; name: string }[];
  products: { code: string; name: string }[];
  suppliers: string[];
  lots: SrcLot[];
  transactionInvoices: SrcTransactionInvoice[];
  purchaseInvoices: SrcPurchaseInvoice[];
}

function cv(cell: ExcelJS.Cell): unknown {
  const v = cell.value as unknown;
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("result" in o) return o.result;
    if ("text" in o) return o.text;
    if ("richText" in o) return (o.richText as { text: string }[]).map((r) => r.text).join("");
  }
  return v;
}
function num(cell: ExcelJS.Cell): number | null {
  const v = cv(cell);
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}
function str(cell: ExcelJS.Cell): string | null {
  const v = cv(cell);
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
function dt(cell: ExcelJS.Cell): Date | null {
  const v = cv(cell);
  if (v instanceof Date) return v;
  if (typeof v === "string" && /\d{4}-\d{2}-\d{2}/.test(v)) return new Date(v);
  return null;
}

/** Map each row in a column's merges to the merge's anchor (start) row. */
function mergeAnchors(ws: ExcelJS.Worksheet, colLetter: string): Map<number, number> {
  const map = new Map<number, number>();
  const merges = (ws.model.merges ?? []) as string[];
  for (const m of merges) {
    const [a, b] = m.split(":");
    if (a.match(/[A-Z]+/)![0] !== colLetter) continue;
    const r1 = parseInt(a.match(/\d+/)![0], 10);
    const r2 = parseInt(b.match(/\d+/)![0], 10);
    for (let r = r1; r <= r2; r++) map.set(r, r1);
  }
  return map;
}

export async function parseWorkbook(path: string): Promise<SrcData> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const supplierSet = new Set<string>();

  // ---------- PO Lots ----------
  const lotsSheet = wb.getWorksheet("PO Lots")!;
  const lotMap = new Map<number, SrcLot>();
  let lastPo: { poNumber: string | null; poDate: Date | null } = { poNumber: null, poDate: null };
  let lseq = 0;
  for (let r = 5; r <= lotsSheet.rowCount; r++) {
    const row = lotsSheet.getRow(r);
    const lotNr = num(row.getCell(4));
    const sku = str(row.getCell(5));
    const units = num(row.getCell(13));
    if (lotNr == null || sku == null) continue;
    const poNum = str(row.getCell(1));
    const poDate = dt(row.getCell(2));
    if (poNum) lastPo.poNumber = poNum;
    if (poDate) lastPo.poDate = poDate;
    const facility = str(row.getCell(3)) ?? "";
    const status = (str(row.getCell(15)) ?? "").toLowerCase().includes("finish") ? "FINISHED" : "IN_PRODUCTION";
    let lot = lotMap.get(lotNr);
    if (!lot) {
      lot = {
        poNumber: lastPo.poNumber,
        lotNr,
        poDate: lastPo.poDate ? lastPo.poDate.getTime() : null,
        poDateISO: lastPo.poDate ? lastPo.poDate.toISOString().slice(0, 10) : null,
        facility,
        notes: str(row.getCell(14)),
        lines: [],
        inboundTxns: [],
      };
      lotMap.set(lotNr, lot);
    }
    lot.lines.push({
      sku,
      units: units ?? 0,
      status: status as "FINISHED" | "IN_PRODUCTION",
      sheetTea: num(row.getCell(6)) ?? 0,
      sheetTbag: num(row.getCell(7)) ?? 0,
      sheetPouch: num(row.getCell(8)) ?? 0,
      sheetOther: num(row.getCell(9)) ?? 0,
      sheetCog: num(row.getCell(10)) ?? 0,
      sheetInbound: num(row.getCell(11)) ?? 0,
      seq: lseq++,
    });
  }

  // ---------- PO Transactions (grouped into invoices via column-E merges) ----------
  const txSheet = wb.getWorksheet("PO Transactions")!;
  const txAnchor = mergeAnchors(txSheet, "E");
  const txInvMap = new Map<number, SrcTransactionInvoice>();
  for (let r = 4; r <= txSheet.rowCount; r++) {
    const row = txSheet.getRow(r);
    const applicable = num(row.getCell(6)) ?? 0;
    const notApplicable = num(row.getCell(10)) ?? 0;
    const lotNr = num(row.getCell(2));
    if (lotNr == null && applicable === 0 && notApplicable === 0) continue;

    const groupKey = txAnchor.get(r) ?? r;
    const supplier = str(row.getCell(4));
    const date = dt(row.getCell(3));
    const rawCat = (str(row.getCell(7)) ?? "TEA").toUpperCase();
    const concept = str(row.getCell(9));

    // INBOUND (Amazon FBA/AWD freight) is never a transaction — summarised in the lot's notes.
    // (Its supplier isn't registered, so an inbound-only vendor never becomes an orphan.)
    if (rawCat === "INBOUND") {
      if (lotNr != null) lotMap.get(lotNr)?.inboundTxns.push({ amount: applicable, concept, supplier });
      continue;
    }
    if (supplier) supplierSet.add(supplier);

    let inv = txInvMap.get(groupKey);
    if (!inv) {
      inv = {
        supplier,
        date: date ? date.getTime() : null,
        dateISO: date ? date.toISOString().slice(0, 10) : null,
        invoiceTotal: num(row.getCell(5)) ?? 0,
        lines: [],
      };
      txInvMap.set(groupKey, inv);
    }

    // Applicable line (TEA / OTHER feed COG).
    if (applicable !== 0) {
      inv.lines.push({
        lotNr,
        category: rawCat === "OTHER" ? "OTHER" : "TEA",
        amount: applicable,
        sku: str(row.getCell(8)),
        concept,
        appliesToCog: true,
      });
    }
    // Not-applicable line (e.g. USDA certification).
    if (notApplicable !== 0) {
      inv.lines.push({
        lotNr,
        category: "NOT_APPLICABLE",
        amount: notApplicable,
        sku: null,
        concept: str(row.getCell(11)),
        appliesToCog: false,
      });
    }
  }

  // ---------- Purchases ----------
  const ps = wb.getWorksheet("Purchases")!;
  const pkAnchor = mergeAnchors(ps, "C");
  const pkInvMap = new Map<number, SrcPurchaseInvoice>();
  const teabagInvoices: SrcPurchaseInvoice[] = [];
  let seq = 0;
  for (let r = 5; r <= ps.rowCount; r++) {
    const row = ps.getRow(r);
    // Packaging / pouches (B..J)
    const pDate = dt(row.getCell(2));
    const pQty = num(row.getCell(5));
    if (pDate && pQty != null) {
      const supplier = str(row.getCell(4));
      if (supplier) supplierSet.add(supplier);
      const isAdj = (supplier ?? "").toLowerCase().includes("lost");
      const total = num(row.getCell(8)) ?? 0;
      const groupKey = pkAnchor.get(r) ?? r;
      let inv = pkInvMap.get(groupKey);
      if (!inv) {
        inv = {
          supplier,
          date: pDate.getTime(),
          dateISO: pDate.toISOString().slice(0, 10),
          materialCode: "POUCH",
          invoiceTotal: num(row.getCell(3)) ?? 0,
          isAdjustment: isAdj,
          notes: str(row.getCell(10)),
          lines: [],
        };
        pkInvMap.set(groupKey, inv);
      }
      inv.lines.push({
        facility: str(row.getCell(7)) ?? "",
        sku: str(row.getCell(6)),
        quantity: pQty,
        unitCost: pQty !== 0 ? total / pQty : 0,
        total,
        isAdjustment: isAdj,
        seq: seq++,
      });
    }
    // Tea bags (L..S) — one invoice per row.
    const tDate = dt(row.getCell(12));
    const tQty = num(row.getCell(14));
    if (tDate && tQty != null) {
      const supplier = str(row.getCell(13));
      if (supplier) supplierSet.add(supplier);
      const total = num(row.getCell(16)) ?? 0;
      teabagInvoices.push({
        supplier,
        date: tDate.getTime(),
        dateISO: tDate.toISOString().slice(0, 10),
        materialCode: "TEABAG",
        invoiceTotal: total,
        isAdjustment: (supplier ?? "").toLowerCase().includes("lost"),
        notes: str(row.getCell(19)),
        lines: [
          {
            facility: str(row.getCell(15)) ?? "",
            sku: null,
            quantity: tQty,
            unitCost: tQty !== 0 ? total / tQty : 0,
            total,
            isAdjustment: (supplier ?? "").toLowerCase().includes("lost"),
            seq: seq++,
          },
        ],
      });
    }
  }

  return {
    facilities: Object.keys(FACILITY_NAMES).map((code) => ({ code, name: FACILITY_NAMES[code] })),
    products: Object.keys(PRODUCT_NAMES).map((code) => ({ code, name: PRODUCT_NAMES[code] })),
    suppliers: [...supplierSet].sort(),
    lots: [...lotMap.values()].sort((a, b) => a.lotNr - b.lotNr),
    transactionInvoices: [...txInvMap.values()].filter((inv) => inv.lines.length > 0),
    purchaseInvoices: [...pkInvMap.values(), ...teabagInvoices],
  };
}
