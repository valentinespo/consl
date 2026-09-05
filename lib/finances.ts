import "server-only";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/secret-box";
import { makeClient, listTransactions, type FinanceTransaction, type SpApiClient } from "@/lib/spapi";
import { getOrgSettings, saveOrgSettings } from "@/lib/settings";
import { getCurrentOrgId } from "@/lib/tenant";
import { getCurrentOrg } from "@/lib/org";
import { fxRate } from "@/lib/fx";

/**
 * Amazon's financial ledger → FinanceEvent rows, the raw material of the P&L.
 *
 * Source: the Finances API v2024-06-19 `transactions` feed — one flat transaction per money
 * movement (a shipment, a refund, a fee invoice, an ad charge…), each with its own id, posted
 * date and a tree of breakdowns down to the component (principal, tax, commission, FBA fee…).
 * We flatten every leaf to one signed row tagged with a P&L bucket and upsert by transaction id,
 * so any window can be re-read at any time and the ledger never doubles.
 *
 * The whole region is imported (a North America account sells the odd unit on Amazon.ca or
 * .com.mx): each row keeps its posted currency and carries the same money in the company's
 * currency, so one statement can add them up.
 *
 * Payout deferral: Amazon charges a sale when it ships but holds the payout until about a week
 * after delivery. The feed shows that sale immediately as a DEFERRED transaction (exact money,
 * exact fees), and later adds a RELEASED copy that points back to it. Both key to the original's
 * id here, so a sale is one transaction whose status moves held → released — revenue lands in the
 * P&L the day it ships, not the day Amazon lets go of the cash.
 */

export type PnlGroup = "sales" | "refunds" | "fba_fees" | "referral_fees" | "storage_fees" | "advertising" | "taxes" | "other";

type FlatRow = {
  postedAt: Date;
  /** P&L attribution date — rewritten to the order's purchase instant for shipment rows. */
  eventAt: Date;
  group: PnlGroup;
  type: string;
  amount: number;
  orderId: string | null;
  sku: string | null;
  quantity: number | null;
  txId: string;
  status: "held" | "released";
  releasedAt: Date | null;
  currency: string;
  marketplaceId: string | null;
  /** `amount` in the company's currency — filled at import from the day's reference rate. */
  baseAmount: number;
  /** Internal: this row should be re-dated to its order's purchase date (stripped before insert). */
  orderDated?: boolean;
};

type AnyObj = Record<string, any>;

const money = (m: unknown): number => {
  const v = (m as { currencyAmount?: number } | null)?.currencyAmount;
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
};

const parseDate = (v: unknown): Date | null => {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Fee type → bucket, mirroring how the settlement P&L reads: FBA fees = per-order fulfillment
 *  only; inbound/removal/placement programmes live under Other; storage = the monthly FBA storage
 *  fee alone (upstream/STAR storage variants also read as Other). */
function feeGroup(type: string): PnlGroup {
  const t = type.toLowerCase();
  if (t.includes("inbound") || t.includes("removal") || t.includes("placement") || t.includes("disposal")) return "other";
  if (t === "fbastoragefee" || t.includes("longtermstorage")) return "storage_fees";
  if (t.includes("upstreamstorage") || t.includes("starstorage")) return "other";
  if (t.includes("fba") || t.includes("fulfillment")) return "fba_fees";
  if (t.includes("commission") || t.includes("chargeback") || t.includes("closingfee") || t.includes("referral")) return "referral_fees";
  if (t.includes("storage")) return "storage_fees";
  return "other";
}

type Leaf = { path: string[]; amount: number };

/** Every terminal node of a breakdown tree with the names leading to it. */
function leaves(node: AnyObj, path: string[], out: Leaf[]): void {
  const name = String(node.breakdownType ?? "");
  const kids: AnyObj[] = Array.isArray(node.breakdowns) ? node.breakdowns : [];
  if (kids.length === 0) out.push({ path: [...path, name], amount: money(node.breakdownAmount) });
  else for (const k of kids) leaves(k, [...path, name], out);
}

/** The component this leaf stands for. Amazon ends most branches in a bare "Base" node, and
 *  writes a fee discount as a "Promo" child of the fee — both read as the branch above them. */
function leafName(path: string[]): string {
  const names = path.filter((n) => n && n !== "Base");
  let name = names[names.length - 1] ?? "Other";
  if (name === "Promo" && names.length > 1) name = names[names.length - 2];
  return name;
}

/** Order-money component → (bucket, label). Labels follow the settlement vocabulary the P&L was
 *  built on (Principal, Tax, ShippingCharge, Promotion, Commission…); `TaxWithheld:` marks what the
 *  marketplace facilitator collected and kept. */
function orderComponent(path: string[]): { group: PnlGroup; type: string } {
  const category = path[0] ?? "";
  const name = leafName(path);
  if (name.startsWith("MarketplaceFacilitatorTax")) return { group: "taxes", type: `TaxWithheld:${name}` };
  switch (category) {
    case "ProductCharges":
      return { group: "sales", type: name === "OurPricePrincipal" ? "Principal" : name };
    case "Shipping":
      return { group: "sales", type: name === "ShippingPrincipal" ? "ShippingCharge" : name };
    case "Tax":
      return { group: "sales", type: name === "OurPriceTax" ? "Tax" : name };
    case "PromoRebates":
    case "Promo":
      return { group: "sales", type: "Promotion" };
    case "Other":
      return name === "GiftwrapPrincipal" ? { group: "sales", type: "GiftWrap" } : { group: "other", type: name };
    case "AmazonFees":
    case "FBAFees":
      return { group: feeGroup(name), type: name };
    default:
      return { group: "other", type: name };
  }
}

function identifiers(tx: AnyObj): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of tx.relatedIdentifiers ?? []) {
    if (r?.relatedIdentifierName && r?.relatedIdentifierValue) out.set(String(r.relatedIdentifierName), String(r.relatedIdentifierValue));
  }
  return out;
}

function productContext(item: AnyObj): { sku: string | null; quantity: number | null } {
  const ctx = (item.contexts ?? []).find((c: AnyObj) => c?.contextType === "ProductContext");
  const qty = ctx?.quantityShipped;
  return { sku: ctx?.sku ? String(ctx.sku) : null, quantity: typeof qty === "number" ? qty : null };
}

/** Push one row, dropping zero-amount noise. */
function push(rows: FlatRow[], row: FlatRow) {
  if (row.amount !== 0) rows.push(row);
}

/** One transaction → flat P&L rows (empty for kinds that aren't P&L, like bank disbursements).
 *  Kinds we don't model explicitly still land — in "other", under the platform's own label — so
 *  the ledger always sums to what Amazon moved; `unhandled` counts them for a verification pass. */
export function flattenTransaction(tx: FinanceTransaction, unhandled?: Map<string, number>): FlatRow[] {
  const rows: FlatRow[] = [];
  const t = tx as AnyObj;
  const kind = String(t.transactionType ?? "");
  const description = String(t.description ?? kind);
  // Not P&L events: money moving to the bank account, and Amazon's rolling reserve being held
  // and released (an "Adjustment" described as "Reserve" — always a ± pair at the same instant).
  if (kind === "Transfer" || /reserve/i.test(kind) || (kind === "Adjustment" && /^reserve/i.test(description))) return rows;
  const postedAt = parseDate(t.postedDate);
  if (!postedAt) return rows;

  const ids = identifiers(t);
  const status: FlatRow["status"] = t.transactionStatus === "DEFERRED" ? "held" : "released";
  const deferred = (t.contexts ?? []).find((c: AnyObj) => c?.contextType === "DeferredContext");
  // A released row's own date is the release; a held one only knows when the hold is due to end.
  const releasedAt = t.transactionStatus === "RELEASED" ? postedAt : parseDate(deferred?.maturityDate);
  const currency = String(t.totalAmount?.currencyCode ?? "USD");
  const base = {
    postedAt,
    eventAt: postedAt,
    orderId: ids.get("ORDER_ID") ?? null,
    txId: ids.get("DEFERRED_TRANSACTION_ID") ?? String(t.transactionId),
    status,
    releasedAt,
    currency,
    marketplaceId: t.marketplaceDetails?.marketplaceId ? String(t.marketplaceDetails.marketplaceId) : null,
    baseAmount: 0, // set at import once the day's rate is known
  };
  // A "Non-Amazon" marketplace is Multi-Channel Fulfillment: Amazon shipping another channel's
  // order. Its fees are real money, kept visibly apart from Amazon-order fees.
  const mcf = /^non-amazon/i.test(String(t.marketplaceDetails?.marketplaceName ?? ""));

  const items: AnyObj[] = Array.isArray(t.items) ? t.items : [];
  const units: { leaves: Leaf[]; sku: string | null; quantity: number | null; fallback: number }[] = items.length
    ? items.map((item) => {
        const ls: Leaf[] = [];
        for (const b of item.breakdowns ?? []) leaves(b, [], ls);
        return { leaves: ls, ...productContext(item), fallback: money(item.totalAmount) };
      })
    : [(() => {
        const ls: Leaf[] = [];
        for (const b of t.breakdowns ?? []) leaves(b, [], ls);
        return { leaves: ls, sku: null, quantity: null, fallback: money(t.totalAmount) };
      })()];

  for (const u of units) {
    // An item with no breakdown tree still carries its total — never drop money on the floor.
    const ls = u.leaves.length ? u.leaves : [{ path: [description], amount: u.fallback }];
    for (const leaf of ls) {
      switch (kind) {
        case "Shipment": {
          const c = orderComponent(leaf.path);
          push(rows, {
            ...base, ...c, type: mcf ? `MCF:${c.type}` : c.type, sku: u.sku, amount: leaf.amount, orderDated: true,
            // Units ride ONLY the shipped Principal rows — one attribution per item, and it is
            // what the COGS calculation multiplies by the FIFO unit cost.
            quantity: c.type === "Principal" ? u.quantity : null,
          });
          break;
        }
        case "Refund":
        case "GuaranteeClaim":
        case "Chargeback": {
          const c = orderComponent(leaf.path);
          const type = c.group === "taxes" ? "TaxWithheld" : c.type;
          push(rows, { ...base, group: "refunds", type: `${kind}:${type}`, sku: u.sku, quantity: null, amount: leaf.amount });
          break;
        }
        case "ServiceFee":
        case "ServiceCharge": {
          // Non-order fees (inbound transportation, storage, subscriptions, credits…) belong in
          // "other" — the FBA-fees bucket is reserved for per-order fulfillment.
          const name = leafName(leaf.path);
          const group: PnlGroup = feeGroup(name) === "storage_fees" ? "storage_fees" : "other";
          push(rows, { ...base, group, type: name, sku: u.sku, quantity: null, amount: leaf.amount });
          break;
        }
        case "FBAInventoryReimbursement":
        case "Adjustment":
        case "MiscellaneousLedgerAdjustment": {
          const group: PnlGroup = description.toLowerCase().includes("storage") ? "storage_fees" : "other";
          push(rows, { ...base, group, type: description, sku: u.sku, quantity: null, amount: leaf.amount });
          break;
        }
        case "ProductAdsPayment":
          push(rows, { ...base, group: "advertising", type: "ProductAdsPayment", sku: null, quantity: null, amount: leaf.amount });
          break;
        default:
          if (unhandled) unhandled.set(kind, (unhandled.get(kind) ?? 0) + 1);
          push(rows, { ...base, group: "other", type: description || kind, sku: u.sku, quantity: null, amount: leaf.amount });
      }
    }
  }
  return rows;
}

async function amazonClient(): Promise<SpApiClient | null> {
  const conn = await prisma.integration.findFirst({ where: { provider: "amazon", status: "connected" } });
  if (!conn?.refreshTokenEnc) return null;
  return makeClient({
    refreshToken: decryptSecret(conn.refreshTokenEnc),
    marketplaceId: conn.marketplaceId ?? "ATVPDKIKX0DER",
    region: conn.region ?? "na",
  });
}

type TxBundle = { rows: FlatRow[]; postedAt: Date; status: FlatRow["status"]; releasedAt: Date | null; actualRelease: boolean };

/** The ledger identity of a transaction: a release copy keys to its held original. */
function txKey(t: AnyObj): string {
  return identifiers(t).get("DEFERRED_TRANSACTION_ID") ?? String(t.transactionId);
}

/** Fold a window's transactions into one bundle per transaction id: a held original and its
 *  release copy carry identical money, so the copy only contributes the release date. */
function bundle(txs: FinanceTransaction[], unhandled: Map<string, number>): Map<string, TxBundle> {
  const out = new Map<string, TxBundle>();
  for (const tx of txs) {
    const rows = flattenTransaction(tx, unhandled);
    if (!rows.length) continue;
    const t = tx as AnyObj;
    const isCopy = identifiers(t).has("DEFERRED_TRANSACTION_ID");
    const key = txKey(t);
    const cur = out.get(key);
    const actualRelease = t.transactionStatus === "RELEASED";
    if (!cur) {
      out.set(key, { rows, postedAt: rows[0].postedAt, status: rows[0].status, releasedAt: rows[0].releasedAt, actualRelease });
      continue;
    }
    // Merge: the original's charge date is the posting date; a copy or later status wins on release.
    if (rows[0].postedAt < cur.postedAt) cur.postedAt = rows[0].postedAt;
    if (!isCopy) cur.rows = rows; // the original carries the item detail at first hand
    if (rows[0].status === "released") cur.status = "released";
    if (actualRelease || (!cur.actualRelease && rows[0].releasedAt)) {
      cur.releasedAt = rows[0].releasedAt;
      cur.actualRelease = cur.actualRelease || actualRelease;
    }
  }
  return out;
}

/** Import one posted-date window: upsert every transaction in it by id. Legacy rows imported
 *  before transactions carried ids are replaced window-wise, so re-walking history migrates them. */
export async function importAmazonFinances(postedAfter: Date, postedBefore: Date): Promise<{ rows: number; unhandled: Record<string, number> }> {
  const client = await amazonClient();
  if (!client) return { rows: 0, unhandled: {} };
  const unhandled = new Map<string, number>();
  const txs = await listTransactions(client, postedAfter, postedBefore);
  const bundles = bundle(txs, unhandled);
  // Every transaction in the window, kept or not: rows of a kind we stopped keeping go away too.
  const keys = [...new Set(txs.map((t) => txKey(t as AnyObj)))];

  // What we already hold for these transactions: a held original imported earlier keeps its charge
  // date when only its release copy is in this window, and a known release date is never replaced
  // by a maturity estimate.
  const existing = new Map<string, { postedAt: Date; status: string | null; releasedAt: Date | null }>();
  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = await prisma.financeEvent.findMany({
      where: { channel: "AMAZON", txId: { in: keys.slice(i, i + 1000) } },
      select: { txId: true, postedAt: true, status: true, releasedAt: true },
      distinct: ["txId"],
    });
    for (const e of chunk) if (e.txId) existing.set(e.txId, e);
  }
  const rows: FlatRow[] = [];
  for (const [key, b] of bundles) {
    const prev = existing.get(key);
    const postedAt = prev && prev.postedAt < b.postedAt ? prev.postedAt : b.postedAt;
    const status = b.status === "released" || prev?.status === "released" ? "released" : "held";
    const releasedAt = b.actualRelease ? b.releasedAt : prev?.status === "released" && prev.releasedAt ? prev.releasedAt : b.releasedAt;
    for (const r of b.rows) rows.push({ ...r, postedAt, status, releasedAt });
  }

  // Re-date shipment money onto its order's purchase instant — the day a seller reads it under.
  const orderIds = [...new Set(rows.filter((r) => r.orderDated && r.orderId).map((r) => r.orderId as string))];
  const orderedAt = new Map<string, Date>();
  for (let i = 0; i < orderIds.length; i += 500) {
    const chunk = await prisma.salesOrder.findMany({
      where: { channel: "AMAZON", externalId: { in: orderIds.slice(i, i + 500) } },
      select: { externalId: true, orderedAt: true },
    });
    for (const o of chunk) orderedAt.set(o.externalId, o.orderedAt);
  }
  for (const r of rows) r.eventAt = r.orderDated && r.orderId ? (orderedAt.get(r.orderId) ?? r.postedAt) : r.postedAt;

  // Sister-marketplace money in the company's currency, at the reference rate of the posting day.
  const baseCurrency = (await getCurrentOrg())?.currencyCode ?? "USD";
  for (const r of rows) r.baseAmount = r.currency === baseCurrency ? r.amount : r.amount * (await fxRate(r.currency, baseCurrency, r.postedAt));

  // Delete + insert atomically so a crash can never leave a half-imported transaction. The
  // advisory lock (released at commit) serializes importers per company: the backfill walker, the
  // live sweep and the nightly reconcile — in this process or another replica — can overlap on a
  // window, and two delete-then-insert transactions running side by side would BOTH insert.
  const orgId = await getCurrentOrgId();
  await prisma.$transaction([
    prisma.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance:${orgId ?? ""}`}))`,
    ...(keys.length ? [prisma.financeEvent.deleteMany({ where: { channel: "AMAZON", txId: { in: keys } } })] : []),
    prisma.financeEvent.deleteMany({ where: { channel: "AMAZON", txId: null, postedAt: { gte: postedAfter, lt: postedBefore } } }),
    ...(rows.length
      ? [prisma.financeEvent.createMany({
          data: rows.map(({ orderDated: _drop, ...r }) => ({ channel: "AMAZON", ...r })),
        })]
      : []),
  ], { timeout: 120_000, maxWait: 15_000 }); // a 7-day window can carry thousands of rows
  if (unhandled.size > 0) console.log("[finances] unmodelled transaction kinds:", Object.fromEntries(unhandled));
  return { rows: rows.length, unhandled: Object.fromEntries(unhandled) };
}

const BACKFILL_WINDOW_DAYS = 7;
// The API refuses a start "before 2 years from now" to the second, so stop a day short of it.
const BACKFILL_FLOOR_DAYS = 729;

/** One backward step of the history walk (scheduler-driven, like the orders backfill). */
export async function backfillAmazonFinancesStep(): Promise<{ done: boolean; rows: number; cursor: string }> {
  const client = await amazonClient();
  if (!client) return { done: true, rows: 0, cursor: "" };
  const s = await getOrgSettings();
  const floor = new Date(Date.now() - BACKFILL_FLOOR_DAYS * 86_400_000);
  // First step starts at now − 3 min: the API refuses a postedBefore within 2 minutes of now.
  const cursorEnd = s.financeBackfillCursor ? new Date(s.financeBackfillCursor) : new Date(Date.now() - 3 * 60_000);
  if (cursorEnd <= floor) return { done: true, rows: 0, cursor: s.financeBackfillCursor ?? "" };
  const start = new Date(Math.max(floor.getTime(), cursorEnd.getTime() - BACKFILL_WINDOW_DAYS * 86_400_000));
  let rows = 0;
  try {
    rows = (await importAmazonFinances(start, cursorEnd)).rows;
  } catch (e) {
    // Amazon's retention edge moves with the clock; hitting it means the history is fully walked.
    if (!/2 years/i.test((e as Error).message)) throw e;
  }
  await saveOrgSettings({ financeBackfillCursor: start.toISOString() });
  return { done: start.getTime() <= floor.getTime(), rows, cursor: start.toISOString() };
}

/** The live leg: sweep [cursor − overlap, now − 2 min) forward. Upserts make the overlap free,
 *  and the 2-minute stand-off is the Finances API's own postedBefore requirement. */
export async function sweepAmazonFinances(): Promise<{ rows: number } | null> {
  const client = await amazonClient();
  if (!client) return null;
  const s = await getOrgSettings();
  const end = new Date(Date.now() - 2 * 60_000);
  const from = s.financeEventsCursor ? new Date(new Date(s.financeEventsCursor).getTime() - 60 * 60_000) : new Date(Date.now() - 3 * 86_400_000);
  if (end.getTime() - from.getTime() < 10 * 60_000) return { rows: 0 };
  const r = await importAmazonFinances(from, end);
  await saveOrgSettings({ financeEventsCursor: end.toISOString() });
  return { rows: r.rows };
}

const RECONCILE_DAYS = 14;

/** Nightly: re-read the last two weeks so anything Amazon revised in place (a held sale it
 *  cancelled, a reissued fee) is caught — the sweep only sees what posts fresh. */
export async function reconcileAmazonFinances(): Promise<{ rows: number } | null> {
  const client = await amazonClient();
  if (!client) return null;
  const end = new Date(Date.now() - 3 * 60_000);
  let rows = 0;
  for (let d = RECONCILE_DAYS; d > 0; d -= BACKFILL_WINDOW_DAYS) {
    const from = new Date(end.getTime() - d * 86_400_000);
    const to = new Date(Math.min(end.getTime(), from.getTime() + BACKFILL_WINDOW_DAYS * 86_400_000));
    rows += (await importAmazonFinances(from, to)).rows;
  }
  return { rows };
}
