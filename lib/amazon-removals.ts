import "server-only";
import { prisma } from "@/lib/prisma";
import { getCurrentOrgId } from "@/lib/tenant";
import { getOrgSettings, saveOrgSettings } from "@/lib/settings";
import { decryptSecret } from "@/lib/secret-box";
import { fetchReportText, makeClient } from "@/lib/spapi";

/**
 * Amazon's removal orders — stock pulled out of Amazon: sent back to the seller, sent to a buyer,
 * or disposed of; made by hand or by Amazon's automatic removals. Amazon's order feed lists every
 * one that ships exactly like an MCF order (a "Non-Amazon" order whose reference is the removal's
 * id), and gets it wrong: one product only, "shipped" when Amazon cancelled it. Its removal order
 * report is the record: what each asked for, shipped, cancelled, and its fee.
 *
 * A removal is never a sale. Its units' cost counts once, from Amazon's inventory ledger (the
 * StockEvent REMOVAL rows → Cost of goods › Removal orders); Amazon's removal fee once, from the
 * money ledger (→ Removals & disposal). So the feed's copy (SalesOrder.removal) counts nowhere:
 * no order total, no cost, no fee rule, never matched to another channel's order. A sale that a
 * removal delivered keeps its own cost unless someone voids it by hand.
 *
 * The first read takes 18 months; later reads take the last 90 days (a removal can stay open for
 * weeks) — and each read moves `amazonRemovalsThrough`, the point up to which the list is complete.
 */

const REPORT = "GET_FBA_FULFILLMENT_REMOVAL_ORDER_DETAIL_DATA";
const HISTORY_DAYS = 540;
const REFRESH_DAYS = 90;
// A removal made in the last moments may not be in the report yet: the list counts as complete up
// to a little before the read.
const SETTLE_MS = 2 * 3_600_000;
const DAY = 86_400_000;

export type RemovalLine = { sku: string; disposition: string | null; requested: number; shipped: number; disposed: number; cancelled: number; inProcess: number; fee: number };
type Removal = { removalId: string; requestedAt: Date; type: string; status: string; source: string | null; lines: RemovalLine[]; fee: number; currency: string };

function rowsOf(text: string): Record<string, string>[] {
  const cell = (v: string | undefined) => {
    const t = (v ?? "").trim();
    return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1).replace(/""/g, '"') : t;
  };
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const head = lines[0].split("\t").map(cell);
  return lines.slice(1).map((l) => {
    const cells = l.split("\t");
    return Object.fromEntries(head.map((h, i) => [h, cell(cells[i])]));
  });
}

/** The report as one entry per removal order, its products as lines. */
export function removalOrders(text: string): Removal[] {
  const num = (v: string | undefined) => (v && Number.isFinite(Number(v)) ? Number(v) : 0);
  const out = new Map<string, Removal>();
  for (const r of rowsOf(text)) {
    const removalId = r["order-id"];
    const requestedAt = new Date(r["request-date"] ?? "");
    if (!removalId || Number.isNaN(requestedAt.getTime())) continue;
    const line: RemovalLine = {
      sku: r["sku"] ?? "",
      disposition: r["disposition"] || null,
      requested: num(r["requested-quantity"]),
      shipped: num(r["shipped-quantity"]),
      disposed: num(r["disposed-quantity"]),
      cancelled: num(r["cancelled-quantity"]),
      inProcess: num(r["in-process-quantity"]),
      fee: num(r["removal-fee"]),
    };
    const cur = out.get(removalId);
    if (cur) {
      cur.lines.push(line);
      cur.fee += line.fee;
    } else {
      out.set(removalId, {
        removalId,
        requestedAt,
        type: r["order-type"] || "Return",
        status: r["order-status"] || "",
        source: r["order-source"] || null,
        lines: [line],
        fee: line.fee,
        currency: r["currency"] || "USD",
      });
    }
  }
  return [...out.values()];
}

/** Mark the feed's copies of known removals (and undo any match they got before they were known),
 *  and give each copy the products its removal really asked for — the feed lists one at most. Lines
 *  are rewritten only when they differ, so a quiet pass changes nothing. */
export async function markRemovalOrders(): Promise<number> {
  const orgId = await getCurrentOrgId();
  if (!orgId) return 0;
  const marked = await prisma.$executeRaw`
    UPDATE "SalesOrder" o SET removal = true, "mcfChannel" = NULL, "mcfOrderId" = NULL
    WHERE o."orgId" = ${orgId} AND o.channel = 'AMAZON' AND o.mcf AND o.removal = false
      AND EXISTS (SELECT 1 FROM "AmazonRemoval" r WHERE r."orgId" = o."orgId" AND r."removalId" = o."mcfRef")`;

  const copies = await prisma.salesOrder.findMany({ where: { channel: "AMAZON", removal: true }, select: { id: true, mcfRef: true, lines: { select: { sku: true, quantity: true } } } });
  if (!copies.length) return marked;
  const records = new Map(
    (await prisma.amazonRemoval.findMany({ where: { removalId: { in: copies.map((c) => c.mcfRef ?? "") } }, select: { removalId: true, lines: true } })).map((r) => [r.removalId, r.lines as RemovalLine[]]),
  );
  const key = (lines: { sku: string | null; quantity: number }[]) => lines.map((l) => `${l.sku}×${l.quantity}`).sort().join("|");
  const stale = copies.flatMap((c) => {
    const want = records.get(c.mcfRef ?? "");
    if (!want?.length) return [];
    const lines = want.map((l) => ({ sku: l.sku, quantity: l.requested }));
    return key(lines) === key(c.lines) ? [] : [{ id: c.id, lines }];
  });
  if (stale.length) {
    const skus = [...new Set(stale.flatMap((c) => c.lines.map((l) => l.sku)))];
    const productOf = new Map((await prisma.product.findMany({ where: { sellerSku: { in: skus } }, select: { id: true, sellerSku: true } })).map((p) => [p.sellerSku as string, p.id]));
    for (const c of stale) {
      await prisma.salesOrderLine.deleteMany({ where: { orderId: c.id } });
      await prisma.salesOrderLine.createMany({ data: c.lines.map((l) => ({ orderId: c.id, productId: productOf.get(l.sku) ?? null, sku: l.sku, quantity: l.quantity, unitPrice: 0 })) });
    }
  }
  return marked;
}

/** Read Amazon's removal orders, store them, and mark their copies in the order feed. */
export async function syncAmazonRemovals(): Promise<{ removals: number; marked: number; from: string; to: string } | null> {
  const orgId = await getCurrentOrgId();
  if (!orgId) return null;
  const conn = await prisma.integration.findFirst({ where: { provider: "amazon", status: "connected" } });
  if (!conn?.refreshTokenEnc) return null;
  const client = makeClient({
    refreshToken: decryptSecret(conn.refreshTokenEnc),
    marketplaceId: conn.marketplaceId ?? "ATVPDKIKX0DER",
    region: conn.region ?? "na",
  });
  const s = await getOrgSettings();
  const now = new Date();
  const from = new Date(now.getTime() - (s.amazonRemovalsSyncedAt ? REFRESH_DAYS : HISTORY_DAYS) * DAY);
  const startISO = from.toISOString().slice(0, 19) + "Z";
  const endISO = now.toISOString().slice(0, 19) + "Z";
  const removals = removalOrders(await fetchReportText(client, REPORT, startISO, endISO, { label: "removal orders", polls: 90, pollMs: 8000 }));
  for (const r of removals) {
    const data = { requestedAt: r.requestedAt, type: r.type, status: r.status, source: r.source, lines: r.lines, fee: Math.round(r.fee * 100) / 100, currency: r.currency };
    await prisma.amazonRemoval.upsert({
      where: { orgId_removalId: { orgId, removalId: r.removalId } },
      create: { removalId: r.removalId, ...data },
      update: data,
    });
  }
  const marked = await markRemovalOrders();
  await saveOrgSettings({ amazonRemovalsSyncedAt: now, amazonRemovalsThrough: new Date(now.getTime() - SETTLE_MS) });
  return { removals: removals.length, marked, from: startISO.slice(0, 10), to: endISO.slice(0, 10) };
}
