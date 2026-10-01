import "server-only";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/secret-box";
import { getOrderSellerRef, makeClient } from "@/lib/spapi";
import { getOrgSettings } from "@/lib/settings";
import { markRemovalOrders } from "@/lib/amazon-removals";
import type { PnlChannel } from "@/lib/pnl-shared";

/**
 * Which channel's sale each Amazon MCF order shipped. Amazon books an MCF order's fees (and any
 * credit on them) against its own order id, but the sale behind it lives on the channel that sold
 * it — so on a channel's P&L those fees belong to that channel, not to Amazon.
 *
 * Amazon keeps the reference the sending app wrote on the order (the orders report's
 * merchant-order-id, the Orders API's SellerOrderId). Shopify's Amazon app writes
 * "Shopify #1234 <id>"; other apps write their own order number or id. The sale is found by:
 *  1. the reference naming one of the company's Shopify or TikTok orders, by its number or its id.
 *     A Shopify copy of another connected channel's order (a TikTok sale Shopify fulfils through
 *     Amazon) belongs to that channel;
 *  2. failing that, the shipment itself: the one order Amazon fulfilled for a channel in the week
 *     before it, with the same products and quantities, that no other MCF order took;
 *  3. failing that, nothing — the P&L splits its fees by each channel's share of the orders Amazon
 *     shipped for them that month (see mcfMoves).
 * Amazon's removal orders come through the same feed looking like MCF orders (lib/amazon-removals):
 * they are never matched, and an order waits until Amazon's removal list covers its day.
 */

const DAY = 86_400_000;
// A Shopify order whose source names another channel is that channel's sale copied into Shopify
// (the same rule the Orders tab uses to drop mirrors).
const MIRROR: Record<string, PnlChannel> = { tiktok: "TIKTOK", amazon: "AMAZON" };
const mirrorOf = (source: string | null): PnlChannel | null => {
  const k = Object.keys(MIRROR).find((m) => (source ?? "").toLowerCase().includes(m));
  return k ? MIRROR[k] : null;
};

/** The reference's pieces that could be an order number or id ("Shopify #1234 5678" → #1234, 1234, 5678). */
function candidates(ref: string): string[] {
  const out = new Set<string>();
  for (const raw of ref.split(/[\s,;|]+/)) {
    const t = raw.trim();
    const bare = t.replace(/^#/, "");
    if (bare.length < 3 || !/\d/.test(bare)) continue;
    out.add(t);
    out.add(bare);
    out.add(`#${bare}`);
    if (/^\d+$/.test(bare)) out.add(`gid://shopify/Order/${bare}`);
  }
  return [...out];
}

/**
 * Ask Amazon for the reference on MCF orders stored before consl read it (newest first, paced to
 * the Orders API's limit). An order Amazon has no reference for is marked with an empty one, so it
 * isn't asked again; a refusal (throttled) stops the pass and the next one carries on.
 */
export async function backfillMcfRefs(max = 40): Promise<{ filled: number; left: number }> {
  const todo = await prisma.salesOrder.findMany({ where: { channel: "AMAZON", mcf: true, mcfRef: null }, orderBy: { orderedAt: "desc" }, select: { id: true, externalId: true }, take: max });
  if (!todo.length) return { filled: 0, left: 0 };
  const conn = await prisma.integration.findFirst({ where: { provider: "amazon", status: "connected" } });
  if (!conn?.refreshTokenEnc) return { filled: 0, left: todo.length };
  const client = makeClient({ refreshToken: decryptSecret(conn.refreshTokenEnc), marketplaceId: conn.marketplaceId ?? "ATVPDKIKX0DER", region: conn.region ?? "na" });
  let filled = 0;
  for (const o of todo) {
    const ref = await getOrderSellerRef(client, o.externalId);
    if (ref === undefined) break;
    await prisma.salesOrder.update({ where: { id: o.id }, data: { mcfRef: ref ?? "" } });
    filled++;
    await new Promise((r) => setTimeout(r, 2100));
  }
  const left = await prisma.salesOrder.count({ where: { channel: "AMAZON", mcf: true, mcfRef: null } });
  return { filled, left };
}

type Lines = { productId: string | null; quantity: number }[];
const shape = (lines: Lines) =>
  [...lines.reduce((m, l) => (l.productId ? m.set(l.productId, (m.get(l.productId) ?? 0) + l.quantity) : m), new Map<string, number>())]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([p, q]) => `${p}×${q}`)
    .join("|");

/** Match every MCF order that has its reference but no channel yet. Idempotent; cheap when nothing is new. */
export async function matchMcfOrders(): Promise<{ matched: number; unmatched: number }> {
  // Removals first, so none is ever matched; and only orders the removal list already covers.
  await markRemovalOrders();
  const { amazonRemovalsThrough: covered } = await getOrgSettings();
  if (!covered) return { matched: 0, unmatched: 0 };
  const pending = await prisma.salesOrder.findMany({
    where: { channel: "AMAZON", mcf: true, removal: false, mcfChannel: null, mcfRef: { not: null }, orderedAt: { lte: covered } },
    select: { id: true, orderedAt: true, mcfRef: true, lines: { select: { productId: true, quantity: true } } },
  });
  if (!pending.length) return { matched: 0, unmatched: 0 };

  // 1. By reference: every piece of every reference, looked up at once.
  const wanted = [...new Set(pending.flatMap((o) => candidates(o.mcfRef ?? "")))];
  const named = wanted.length
    ? await prisma.salesOrder.findMany({
        where: { channel: { in: ["SHOPIFY", "TIKTOK"] }, OR: [{ orderNumber: { in: wanted } }, { externalId: { in: wanted } }] },
        select: { id: true, channel: true, orderNumber: true, externalId: true, source: true },
      })
    : [];
  const byKey = new Map<string, (typeof named)[number][]>();
  for (const s of named) for (const k of [s.orderNumber, s.externalId]) if (k) byKey.set(k, [...(byKey.get(k) ?? []), s]);

  const taken = new Set((await prisma.salesOrder.findMany({ where: { channel: "AMAZON", mcf: true, removal: false, mcfOrderId: { not: null } }, select: { mcfOrderId: true } })).map((o) => o.mcfOrderId!));
  const channelOf = (s: { channel: string; source: string | null }): PnlChannel => (s.channel === "SHOPIFY" ? mirrorOf(s.source) : null) ?? (s.channel as PnlChannel);
  // What the P&L needs is the channel: candidates that all belong to one channel settle it (the
  // first of them is kept as the order); candidates on two channels settle nothing.
  type Candidate = { id: string; channel: string; source: string | null };
  const settle = (cands: Candidate[]): { channel: PnlChannel; orderId: string } | null => {
    const channels = new Set(cands.map(channelOf));
    if (channels.size !== 1) return null;
    const channel = [...channels][0];
    const pick = cands.find((c) => c.channel === channel) ?? cands[0];
    return { channel, orderId: pick.id };
  };
  const found = new Map<string, { channel: PnlChannel; orderId: string }>();
  for (const o of pending) {
    const hits = new Map<string, Candidate>();
    for (const c of candidates(o.mcfRef ?? "")) for (const s of byKey.get(c) ?? []) hits.set(s.id, s);
    const m = settle([...hits.values()]);
    if (m) {
      found.set(o.id, m);
      taken.add(m.orderId);
    }
  }

  // 2. By the shipment: same products and quantities, fulfilled from Amazon, in the week before.
  const rest = pending.filter((o) => !found.has(o.id) && shape(o.lines));
  if (rest.length) {
    const first = Math.min(...rest.map((o) => o.orderedAt.getTime())) - 7 * DAY;
    const last = Math.max(...rest.map((o) => o.orderedAt.getTime())) + DAY;
    const pool = await prisma.salesOrder.findMany({
      where: {
        channel: { in: ["SHOPIFY", "TIKTOK"] }, cancelled: false, orderedAt: { gte: new Date(first), lte: new Date(last) },
        OR: [{ fulfillmentOverrideFacility: { channel: { startsWith: "AMAZON" } } }, { fulfillmentOverrideFacilityId: null, fulfillmentFacility: { channel: { startsWith: "AMAZON" } } }],
      },
      select: { id: true, channel: true, source: true, orderedAt: true, lines: { select: { productId: true, quantity: true } } },
    });
    for (const o of rest) {
      const want = shape(o.lines);
      const t = o.orderedAt.getTime();
      const fits = pool.filter((s) => !taken.has(s.id) && s.orderedAt.getTime() >= t - 7 * DAY && s.orderedAt.getTime() <= t + DAY && shape(s.lines) === want);
      // A TikTok sale and its Shopify copy resolve to the same channel, so they settle it together.
      const m = settle(fits.sort((a, b) => Math.abs(a.orderedAt.getTime() - t) - Math.abs(b.orderedAt.getTime() - t)));
      if (!m) continue;
      found.set(o.id, m);
      taken.add(m.orderId);
    }
  }

  for (const [id, m] of found) await prisma.salesOrder.update({ where: { id }, data: { mcfChannel: m.channel, mcfOrderId: m.orderId } });
  return { matched: found.size, unmatched: pending.length - found.size };
}

/** One movement of MCF money off Amazon's statement: to the channels it belongs to, by share. */
export type McfMove = { day: string; group: string; type: string; amount: number; to: [PnlChannel, number][] };

/**
 * Amazon's MCF money in a window, with where it belongs: the matched sale's channel — or, when
 * that channel isn't connected any more, the channel its matched order was copied into — and for
 * an order with no match, every connected channel by its share of the orders Amazon shipped for it
 * that month (all time when the month has none). Nothing to move to: it stays Amazon's. The rows
 * stay Amazon's in the ledger and in the completeness check; the statement moves their amounts.
 * The same filters as the statement's own ledger query, so nothing moves that was never counted.
 */
export async function mcfMoves(
  orgId: string,
  window: { from: Date; to: Date },
  tz: string,
  present: PnlChannel[],
  amazonSkus: string[],
): Promise<McfMove[]> {
  if (!present.includes("AMAZON") || present.length < 2) return [];
  const rows = await prisma.$queryRaw<{ group: string; type: string; day: string; month: string; target: string | null; via: string | null; removal: boolean; amount: number }[]>`
    SELECT fe."group", fe.type,
      (fe."eventAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::date::text AS day,
      to_char(fe."eventAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz}, 'YYYY-MM') AS month,
      so."mcfChannel" AS target, m.channel AS via, COALESCE(so.removal, false) AS removal,
      COALESCE(SUM(fe."baseAmount"), 0)::float8 AS amount
    FROM "FinanceEvent" fe
    LEFT JOIN "SalesOrder" so ON so."orgId" = fe."orgId" AND so.channel = 'AMAZON' AND so."externalId" = fe."orderId" AND so.mcf
    LEFT JOIN "SalesOrder" m ON m.id = so."mcfOrderId"
    WHERE fe."orgId" = ${orgId} AND fe.channel = 'AMAZON'
      AND fe."eventAt" >= ${window.from} AND fe."eventAt" <= ${window.to}
      AND (so.id IS NOT NULL OR fe.type LIKE 'MCF:%')
      AND (fe.sku IS NULL OR fe.sku = ANY(${amazonSkus}::text[]))
      AND NOT EXISTS (
        SELECT 1 FROM "SalesOrder" v
        WHERE v."orgId" = fe."orgId" AND v.channel = 'AMAZON' AND v."externalId" = fe."orderId" AND (v.voided OR v."revenueVoided"))
      AND (fe."txId" IS NULL OR fe."txId" NOT LIKE 'ads:%')
      AND fe."group" <> 'cash'
    GROUP BY 1, 2, 3, 4, 5, 6, 7`;
  if (!rows.length) return [];

  const shares = await mcfShares(orgId, tz, present);
  const out: McfMove[] = [];
  for (const r of rows) {
    // A removal's money (its fee) is Amazon's: it never moves.
    if (r.removal) continue;
    const to = mcfRoute(r.target, r.via, r.month, present, shares);
    if (to.length) out.push({ day: r.day, group: r.group, type: r.type, amount: r.amount, to });
  }
  return out;
}

/** Where one MCF order's money goes (see mcfMoves); empty = it stays Amazon's. */
export function mcfRoute(target: string | null, via: string | null, month: string, present: PnlChannel[], shares: Map<string, [PnlChannel, number][]>): [PnlChannel, number][] {
  const others: PnlChannel[] = present.filter((c) => c !== "AMAZON");
  if (target && others.includes(target as PnlChannel)) return [[target as PnlChannel, 1]];
  if (target && via && others.includes(via as PnlChannel)) return [[via as PnlChannel, 1]];
  if (target) return [];
  return shares.get(month) ?? shares.get("*") ?? [];
}

/** Each connected channel's share of the orders Amazon fulfilled for it, per month (and "*" for
 *  all time). A Shopify copy of a connected channel's order is that channel's sale, counted once. */
export async function mcfShares(orgId: string, tz: string, present: PnlChannel[]): Promise<Map<string, [PnlChannel, number][]>> {
  const rows = await prisma.$queryRaw<{ month: string; channel: string; source: string | null; n: number }[]>`
    SELECT to_char(so."orderedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz}, 'YYYY-MM') AS month, so.channel, so.source, count(*)::int AS n
    FROM "SalesOrder" so
    JOIN "Facility" f ON f.id = COALESCE(so."fulfillmentOverrideFacilityId", so."fulfillmentFacilityId")
    WHERE so."orgId" = ${orgId} AND so.channel IN ('SHOPIFY', 'TIKTOK') AND so.cancelled = false AND so.voided = false
      AND f.channel LIKE 'AMAZON%'
    GROUP BY 1, 2, 3`;
  const counts = new Map<string, Map<PnlChannel, number>>();
  const bump = (month: string, ch: PnlChannel, n: number) => {
    const m = counts.get(month) ?? new Map<PnlChannel, number>();
    m.set(ch, (m.get(ch) ?? 0) + n);
    counts.set(month, m);
  };
  for (const r of rows) {
    const copyOf = r.channel === "SHOPIFY" ? mirrorOf(r.source) : null;
    // The connected channel's own order is counted already; its Shopify copy would count it twice.
    if (copyOf && present.includes(copyOf)) continue;
    const ch = r.channel as PnlChannel;
    if (!present.includes(ch)) continue;
    bump(r.month, ch, r.n);
    bump("*", ch, r.n);
  }
  const out = new Map<string, [PnlChannel, number][]>();
  for (const [month, m] of counts) {
    const total = [...m.values()].reduce((t, n) => t + n, 0);
    if (total > 0) out.set(month, [...m].map(([ch, n]) => [ch, n / total] as [PnlChannel, number]));
  }
  return out;
}
