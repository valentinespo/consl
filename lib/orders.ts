import "server-only";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/secret-box";
import { shopifyGraphQL } from "@/lib/shopify";

/**
 * Pull orders from the connected channels into SalesOrder/SalesOrderLine — the raw feed for
 * velocity and, later, profit. Every importer is idempotent: it upserts by (channel, externalId)
 * and replaces the order's lines, so a re-run backfills new orders and refreshes changed ones
 * without duplicating anything.
 *
 * Dedup is handled at READ time, not here (see lib/order-metrics.ts): each Shopify order records
 * the sales channel that created it, and the org's exclusion list drops the mirrored ones from
 * Shopify totals. Storing everything keeps the toggle reversible.
 */

export type OrderImportResult = { channel: string; orders: number; lines: number; error?: string };

type FetchedLine = { sku: string | null; quantity: number; unitPrice: number; variantId?: string };
type Fetched = {
  externalId: string;
  orderNumber: string | null;
  orderedAt: Date;
  source: string | null;
  sourceLabel: string | null;
  status: string | null;
  cancelled: boolean;
  // Amazon only: MCF (shipped for another channel — $0 here on purpose) / replacement re-ships.
  mcf?: boolean;
  replacement?: boolean;
  fulfillment: string | null;
  fulfillmentLabel: string | null;
  total: number;
  currency: string;
  lines: FetchedLine[];
};

/** channel SKU → consl productId, from the same columns the mapping screen writes. */
async function productMap(channel: "SHOPIFY" | "AMAZON" | "TIKTOK") {
  const products = await prisma.product.findMany({
    select: { id: true, sellerSku: true, shopifyVariantId: true, shopifySku: true, tiktokSku: true },
  });
  const bySku = new Map<string, string>();
  const byVariant = new Map<string, string>();
  for (const p of products) {
    if (channel === "SHOPIFY") {
      if (p.shopifyVariantId) byVariant.set(p.shopifyVariantId, p.id);
      if (p.shopifySku) bySku.set(p.shopifySku.trim(), p.id);
    } else if (channel === "TIKTOK") {
      if (p.tiktokSku) bySku.set(p.tiktokSku.trim(), p.id);
    } else {
      if (p.sellerSku) bySku.set(p.sellerSku.trim(), p.id);
    }
  }
  return { bySku, byVariant };
}

/** Write one channel's fetched orders, replacing each order's lines. Runs each order in its own
 *  transaction so a single malformed order can't roll back the whole batch. */
async function persist(
  channel: "SHOPIFY" | "AMAZON" | "TIKTOK",
  fetched: Fetched[],
  resolve: (line: FetchedLine) => string | null,
): Promise<OrderImportResult> {
  let orders = 0;
  let lines = 0;
  for (const o of fetched) {
    try {
      const existing = await prisma.salesOrder.findFirst({
        where: { channel, externalId: o.externalId },
        select: { id: true },
      });
      const data = {
        orderNumber: o.orderNumber,
        orderedAt: o.orderedAt,
        source: o.source,
        sourceLabel: o.sourceLabel,
        status: o.status,
        cancelled: o.cancelled,
        mcf: o.mcf ?? false,
        replacement: o.replacement ?? false,
        fulfillment: o.fulfillment,
        fulfillmentLabel: o.fulfillmentLabel,
        total: o.total,
        currency: o.currency,
      };
      const order = existing
        ? await prisma.salesOrder.update({ where: { id: existing.id }, data })
        : await prisma.salesOrder.create({ data: { channel, externalId: o.externalId, ...data } });
      // Replace the order's lines wholesale. Not wrapped in a transaction: a rare failure between
      // the two leaves the order briefly line-less and the next import repairs it — cheap insurance
      // versus a per-order transaction across a multi-hundred-order backfill.
      if (existing) await prisma.salesOrderLine.deleteMany({ where: { orderId: order.id } });
      if (o.lines.length) {
        await prisma.salesOrderLine.createMany({
          data: o.lines.map((l) => ({ orderId: order.id, productId: resolve(l), sku: l.sku, quantity: l.quantity, unitPrice: l.unitPrice })),
        });
        lines += o.lines.length;
      }
      orders++;
    } catch {
      // skip the one bad order; the rest of the batch still lands
    }
  }
  return { channel, orders, lines };
}

const money = (v?: string | null) => (v != null && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : 0);

type ShopifyOrderNode = {
  id: string;
  name: string | null;
  createdAt: string;
  sourceName: string | null;
  cancelledAt: string | null;
  displayFinancialStatus: string | null;
  app: { name: string | null } | null;
  channelInformation: { channelDefinition: { channelName: string | null } | null } | null;
  currentTotalPriceSet: { shopMoney: { amount: string; currencyCode: string } } | null;
  fulfillments: Array<{ location: { name: string | null } | null }>;
  lineItems: {
    nodes: Array<{
      sku: string | null;
      quantity: number;
      variant: { id: string } | null;
      discountedUnitPriceSet: { shopMoney: { amount: string } } | null;
      originalUnitPriceSet: { shopMoney: { amount: string } } | null;
    }>;
  };
};

// One field list shared by the paged importer and the webhook's single-order refetch, so the two
// can never drift apart on what an order means.
const SHOPIFY_ORDER_FIELDS = `
  id name createdAt sourceName cancelledAt displayFinancialStatus
  app { name }
  channelInformation { channelDefinition { channelName } }
  currentTotalPriceSet { shopMoney { amount currencyCode } }
  fulfillments(first: 3) { location { name } }
  lineItems(first: 100) {
    nodes { sku quantity variant { id } discountedUnitPriceSet { shopMoney { amount } } originalUnitPriceSet { shopMoney { amount } } }
  }`;

function mapShopifyOrder(o: ShopifyOrderNode): Fetched {
  const location = o.fulfillments.map((f) => f.location?.name).find(Boolean);
  return {
    externalId: o.id,
    orderNumber: o.name || null,
    orderedAt: new Date(o.createdAt),
    source: o.sourceName?.trim() || null,
    sourceLabel: o.channelInformation?.channelDefinition?.channelName || o.app?.name || o.sourceName || null,
    status: o.displayFinancialStatus,
    cancelled: Boolean(o.cancelledAt),
    fulfillment: null, // Shopify orders are seller-fulfilled from consl's perspective
    fulfillmentLabel: location ?? "Unfulfilled",
    total: money(o.currentTotalPriceSet?.shopMoney.amount),
    currency: o.currentTotalPriceSet?.shopMoney.currencyCode ?? "USD",
    lines: o.lineItems.nodes.map((l) => ({
      sku: l.sku?.trim() || null,
      quantity: l.quantity,
      // Prefer the discounted unit price so promo/coupon discounts are reflected in revenue.
      unitPrice: money(l.discountedUnitPriceSet?.shopMoney.amount ?? l.originalUnitPriceSet?.shopMoney.amount),
      variantId: l.variant?.id ?? undefined,
    })),
  };
}

const shopifyResolver = (map: Awaited<ReturnType<typeof productMap>>) => (l: FetchedLine) =>
  (l.variantId ? map.byVariant.get(l.variantId) : undefined) ?? (l.sku ? map.bySku.get(l.sku) ?? null : null);

/**
 * Shopify orders — the dedup centerpiece. `sourceName` / app / channel tells us which sales
 * channel created each order ("web", "tiktok", …); we keep it so mirrored orders (TikTok selling
 * through Shopify) can be excluded from Shopify totals without re-importing.
 */
export async function importShopifyOrders(sinceDays?: number): Promise<OrderImportResult> {
  const conn = await prisma.integration.findFirst({ where: { provider: "shopify", status: "connected" } });
  if (!conn?.refreshTokenEnc || !conn.sellerId) return { channel: "SHOPIFY", orders: 0, lines: 0 };
  const token = decryptSecret(conn.refreshTokenEnc);
  const map = await productMap("SHOPIFY");

  const filter = sinceDays ? `created_at:>=${new Date(Date.now() - sinceDays * 86_400_000).toISOString()}` : "";
  const fetched: Fetched[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < 60; page++) {
    const data: {
      orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ShopifyOrderNode[] };
    } = await shopifyGraphQL(
      conn.sellerId,
      token,
      `query($cursor: String, $q: String) {
        orders(first: 100, after: $cursor, sortKey: CREATED_AT, query: $q) {
          pageInfo { hasNextPage endCursor }
          nodes { ${SHOPIFY_ORDER_FIELDS} }
        }
      }`,
      { cursor, q: filter },
    );
    fetched.push(...data.orders.nodes.map(mapShopifyOrder));
    if (!data.orders.pageInfo.hasNextPage) break;
    cursor = data.orders.pageInfo.endCursor;
  }

  return persist("SHOPIFY", fetched, shopifyResolver(map));
}

/** Refetch ONE Shopify order by gid and upsert it — the webhook handler's workhorse. The webhook
 *  payload is treated as a doorbell only; the data always comes from the API, so a forged or stale
 *  payload can never write anything. */
export async function importShopifyOrderById(orderGid: string): Promise<OrderImportResult> {
  const conn = await prisma.integration.findFirst({ where: { provider: "shopify", status: "connected" } });
  if (!conn?.refreshTokenEnc || !conn.sellerId) return { channel: "SHOPIFY", orders: 0, lines: 0 };
  const token = decryptSecret(conn.refreshTokenEnc);
  const data: { node: ShopifyOrderNode | null } = await shopifyGraphQL(
    conn.sellerId,
    token,
    `query($id: ID!) { node(id: $id) { ... on Order { ${SHOPIFY_ORDER_FIELDS} } } }`,
    { id: orderGid },
  );
  if (!data.node?.id) return { channel: "SHOPIFY", orders: 0, lines: 0 };
  const map = await productMap("SHOPIFY");
  return persist("SHOPIFY", [mapShopifyOrder(data.node)], shopifyResolver(map));
}

type TikTokOrder = {
  id: string;
  status?: string | null;
  order_status?: string | null;
  create_time?: number | null;
  fulfillment_type?: string | null; // FULFILLMENT_BY_TIKTOK | FULFILLMENT_BY_SELLER
  warehouse_id?: string | null;
  payment?: { sub_total?: string | null; total_amount?: string | null; currency?: string | null } | null;
  line_items?: Array<{
    seller_sku?: string | null;
    sku_id?: string | null;
    sale_price?: string | null;
    original_price?: string | null;
    seller_discount?: string | null;
    platform_discount?: string | null;
  }> | null;
};

/** TikTok Shop orders. Today this is the sandbox test store (a couple of orders); when the real
 *  shop is connected it replaces the sandbox by the same (channel, externalId) upsert.
 *  `sinceDays` bounds the pull for the recurring refresh; omit for a full-history import. */
export async function importTikTokOrders(sinceDays?: number): Promise<OrderImportResult> {
  const conn = await prisma.integration.findFirst({ where: { provider: "tiktok", status: "connected" } });
  if (!conn?.marketplaceId) return { channel: "TIKTOK", orders: 0, lines: 0 };
  const { getTikTokAccessToken } = await import("@/lib/tiktok-oauth");
  const { tiktokApi, TIKTOK_API_VERSION } = await import("@/lib/tiktok");
  const token = await getTikTokAccessToken(conn);
  const map = await productMap("TIKTOK");
  // warehouse_id → facility name, so the "Fulfilled at" column reads the real warehouse.
  const warehouses = await prisma.facility.findMany({ where: { channel: "TIKTOK", externalId: { not: null } }, select: { externalId: true, name: true } });
  const warehouseName = new Map(warehouses.map((f) => [f.externalId!, f.name]));

  const fetched: Fetched[] = [];
  let pageToken: string | null = null;
  for (let page = 0; page < 200; page++) {
    const query: Record<string, string> = {
      shop_cipher: conn.marketplaceId,
      page_size: "50",
      ...(pageToken ? { page_token: pageToken } : {}),
    };
    const data = await tiktokApi<{ orders?: TikTokOrder[] | null; next_page_token?: string | null }>({
      method: "POST",
      path: `/order/${TIKTOK_API_VERSION}/orders/search`,
      accessToken: token,
      query,
      body: sinceDays ? { create_time_ge: Math.floor(Date.now() / 1000) - sinceDays * 86_400 } : {},
    });
    fetched.push(...(data.orders ?? []).map((o) => mapTikTokOrder(o, warehouseName)));
    pageToken = data.next_page_token || null;
    if (!pageToken) break;
  }

  return persist("TIKTOK", fetched, (l) => (l.sku ? map.bySku.get(l.sku) ?? null : null));
}

function mapTikTokOrder(o: TikTokOrder, warehouseName: Map<string, string>): Fetched {
  const status = o.status ?? o.order_status ?? null;
  const byTikTok = o.fulfillment_type?.includes("TIKTOK");
  // TikTok emits one line_item per unit — collapse same-SKU lines into a quantity.
  const bySku = new Map<string, FetchedLine>();
  for (const l of o.line_items ?? []) {
    const sku = l.seller_sku?.trim() || null;
    // Net of seller + platform discounts, so the total counts discounts (per the merchant's ask).
    const unitPrice = Math.max(0, money(l.sale_price ?? l.original_price) - money(l.seller_discount) - money(l.platform_discount));
    const cur = bySku.get(sku ?? "");
    if (cur) cur.quantity += 1;
    else bySku.set(sku ?? "", { sku, quantity: 1, unitPrice });
  }
  return {
    externalId: o.id,
    orderNumber: o.id,
    orderedAt: o.create_time ? new Date(o.create_time * 1000) : new Date(0),
    source: null,
    sourceLabel: null,
    status,
    cancelled: (status ?? "").toUpperCase().includes("CANCEL"),
    fulfillment: byTikTok ? "TIKTOK" : o.fulfillment_type ? "SELLER" : null,
    fulfillmentLabel:
      (o.warehouse_id ? warehouseName.get(o.warehouse_id) : undefined) ?? (byTikTok ? "TikTok" : o.fulfillment_type ? "Seller" : null),
    // The order's Total is what the buyer actually PAID — shipping, taxes and discounts all
    // applied (a 100%-discounted sample is $0). Product-only revenue lives on the lines.
    total: money(o.payment?.total_amount ?? o.payment?.sub_total),
    currency: o.payment?.currency ?? "USD",
    lines: [...bySku.values()],
  };
}

/** Refetch specific TikTok orders by id and upsert them — the webhook handler's workhorse. Like
 *  Shopify's, the webhook is only a doorbell: the data always comes from the API. */
export async function importTikTokOrderIds(ids: string[]): Promise<OrderImportResult> {
  const conn = await prisma.integration.findFirst({ where: { provider: "tiktok", status: "connected" } });
  if (!conn?.marketplaceId || ids.length === 0) return { channel: "TIKTOK", orders: 0, lines: 0 };
  const { getTikTokAccessToken } = await import("@/lib/tiktok-oauth");
  const { tiktokApi, TIKTOK_API_VERSION } = await import("@/lib/tiktok");
  const token = await getTikTokAccessToken(conn);
  const map = await productMap("TIKTOK");
  const warehouses = await prisma.facility.findMany({ where: { channel: "TIKTOK", externalId: { not: null } }, select: { externalId: true, name: true } });
  const warehouseName = new Map(warehouses.map((f) => [f.externalId!, f.name]));

  const data = await tiktokApi<{ orders?: TikTokOrder[] | null }>({
    method: "GET",
    path: `/order/${TIKTOK_API_VERSION}/orders`,
    accessToken: token,
    query: { shop_cipher: conn.marketplaceId, ids: ids.slice(0, 50).join(",") },
  });
  const fetched = (data.orders ?? []).map((o) => mapTikTokOrder(o, warehouseName));
  return persist("TIKTOK", fetched, (l) => (l.sku ? map.bySku.get(l.sku) ?? null : null));
}

/** Amazon marketplace orders from the All Orders report, order-level. `fulfillment` keeps FBA vs
 *  merchant so pool attribution can use it later. No dedup vs Shopify — Amazon orders don't mirror
 *  into Shopify (an MCF order is a Shopify sale Amazon ships, and stays on the Shopify side). */
export async function importAmazonOrders(window: { start: Date; end: Date } | number = 90): Promise<OrderImportResult> {
  const conn = await prisma.integration.findFirst({ where: { provider: "amazon", status: "connected" } });
  if (!conn?.refreshTokenEnc) return { channel: "AMAZON", orders: 0, lines: 0 };
  const { makeClient, getAllOrderRows } = await import("@/lib/spapi");
  const client = makeClient({
    refreshToken: decryptSecret(conn.refreshTokenEnc),
    marketplaceId: conn.marketplaceId ?? "ATVPDKIKX0DER",
    region: conn.region ?? "na",
  });
  const map = await productMap("AMAZON");

  const end = typeof window === "number" ? new Date() : window.end;
  const start = typeof window === "number" ? new Date(end.getTime() - window * 86_400_000) : window.start;
  const iso = (d: Date) => d.toISOString().slice(0, 19) + "Z";
  const rows = await getAllOrderRows(client, iso(start), iso(end));

  // Group item rows → orders → per-SKU lines. The order's `total` is what the buyer PAID
  // (items + taxes + shipping, net of all promotions); the lines carry net product revenue.
  const byOrder = new Map<string, Fetched & { _skus: Map<string, { sku: string; qty: number; amt: number }> }>();
  for (const row of rows) {
    let o = byOrder.get(row.orderId);
    if (!o) {
      o = {
        externalId: row.orderId,
        orderNumber: row.orderId,
        orderedAt: row.purchaseDate ? new Date(row.purchaseDate) : new Date(0),
        source: null,
        sourceLabel: null,
        status: row.status,
        cancelled: row.status === "Cancelled",
        // "Non-Amazon" sales channel = an MCF order (Amazon shipping another channel's sale).
        mcf: /^non.?amazon/i.test(row.salesChannel),
        replacement: row.isReplacement,
        fulfillment: row.fulfillment === "Amazon" ? "Amazon" : "Merchant",
        fulfillmentLabel: row.fulfillment === "Amazon" ? "Amazon FBA" : "Merchant",
        total: 0,
        currency: row.currency,
        lines: [],
        _skus: new Map(),
      };
      byOrder.set(row.orderId, o);
    }
    const netProduct = row.itemPrice - row.promotionDiscount;
    o.total += netProduct + row.itemTax + row.shippingPrice + row.shippingTax - row.shipPromotionDiscount;
    const agg = o._skus.get(row.sku) ?? { sku: row.sku, qty: 0, amt: 0 };
    agg.qty += row.quantity;
    agg.amt += netProduct;
    o._skus.set(row.sku, agg);
  }
  const fetched: Fetched[] = [...byOrder.values()].map((o) => ({
    ...o,
    lines: [...o._skus.values()].map((a) => ({ sku: a.sku, quantity: a.qty, unitPrice: a.qty > 0 ? a.amt / a.qty : 0 })),
  }));

  return persist("AMAZON", fetched, (l) => (l.sku ? map.bySku.get(l.sku) ?? null : null));
}

// Amazon's All Orders report retains ~2 years; don't walk the backfill cursor past this.
const AMAZON_BACKFILL_FLOOR_DAYS = 760;
// Per backfill step. getAllOrderRows splits this into ≤30-day reports internally (concurrency 2),
// so a 90-day step is ~3 reports — fewer scheduler passes to cover the ~2-year history.
const BACKFILL_WINDOW_DAYS = 90;

/**
 * One step of the Amazon lifetime backfill, driven by the scheduler so a multi-year history fills
 * in over many ticks without a giant blocking pull or tripping the report quota. Walks
 * Settings.ordersBackfillCursor backward one 30-day window per call; returns whether more remains.
 * Idempotent (upsert), so a restart mid-backfill simply resumes from the stored cursor.
 */
export async function backfillAmazonOrdersStep(): Promise<{ done: boolean; imported: number; cursor: string }> {
  const conn = await prisma.integration.findFirst({ where: { provider: "amazon", status: "connected" } });
  if (!conn?.refreshTokenEnc) return { done: true, imported: 0, cursor: "" };

  const { getOrgSettings, saveOrgSettings } = await import("@/lib/settings");
  const s = await getOrgSettings();
  const floor = new Date(Date.now() - AMAZON_BACKFILL_FLOOR_DAYS * 86_400_000);
  // Start the cursor at "now" the first time; thereafter it's the oldest date already covered.
  const cursorEnd = s.ordersBackfillCursor ? new Date(s.ordersBackfillCursor) : new Date();
  if (cursorEnd <= floor) return { done: true, imported: 0, cursor: s.ordersBackfillCursor ?? "" };

  const start = new Date(Math.max(floor.getTime(), cursorEnd.getTime() - BACKFILL_WINDOW_DAYS * 86_400_000));
  const r = await importAmazonOrders({ start, end: cursorEnd });
  const nextCursor = start.toISOString().slice(0, 10);
  await saveOrgSettings({ ordersBackfillCursor: nextCursor });
  return { done: start.getTime() <= floor.getTime(), imported: r.orders, cursor: nextCursor };
}

/** Import orders from every connected channel. Legs are independent — one failing never blocks the
 *  others. `amazonSinceDays` bounds the slow, quota-limited Amazon report (deeper history is a
 *  separate background backfill); Shopify/TikTok pull in full. */
export async function importAllOrders(amazonSinceDays = 90): Promise<OrderImportResult[]> {
  const out: OrderImportResult[] = [];
  for (const run of [
    () => importShopifyOrders(),
    () => importTikTokOrders(),
    () => importAmazonOrders(amazonSinceDays),
  ]) {
    try {
      out.push(await run());
    } catch (e) {
      console.error("[importAllOrders] leg failed:", e instanceof Error ? e.message : e);
      out.push({ channel: "?", orders: 0, lines: 0, error: e instanceof Error ? e.message : "failed" });
    }
  }
  return out;
}

/**
 * Near-real-time Amazon orders: a cursored sweep of the live Orders API (orders updated since the
 * last sweep). Amazon offers no plain-HTTPS webhooks — their push needs AWS queues — so a
 * few-minute poll of this feed is the practical equivalent and needs no extra infrastructure.
 *
 * The Orders API's OrderTotal is already the buyer's grand total (items + tax + shipping, net of
 * promos), matching the report-based importer's math. Lines carry net product revenue. Pending
 * orders often lack totals/items; they refresh on a later sweep once Amazon finalises them.
 */
export async function pollAmazonOrders(): Promise<OrderImportResult & { cursor?: string }> {
  const conn = await prisma.integration.findFirst({ where: { provider: "amazon", status: "connected" } });
  if (!conn?.refreshTokenEnc) return { channel: "AMAZON", orders: 0, lines: 0 };
  const { makeClient, getOrdersUpdatedSince, getOrderItems } = await import("@/lib/spapi");
  const { getOrgSettings, saveOrgSettings } = await import("@/lib/settings");
  const client = makeClient({
    refreshToken: decryptSecret(conn.refreshTokenEnc),
    marketplaceId: conn.marketplaceId ?? "ATVPDKIKX0DER",
    region: conn.region ?? "na",
  });
  const map = await productMap("AMAZON");

  const s = await getOrgSettings();
  // First sweep reaches back a few hours; afterwards, from just before the last sweep (2-min
  // overlap so a clock skew can't drop an order — the upsert makes overlap free).
  const since = s.ordersPollCursor
    ? new Date(new Date(s.ordersPollCursor).getTime() - 2 * 60_000)
    : new Date(Date.now() - 6 * 60 * 60_000);
  const sweepStart = new Date();
  const changed = await getOrdersUpdatedSince(client, since.toISOString());

  const fetched: Fetched[] = [];
  for (const o of changed.slice(0, 60)) {
    let lines: FetchedLine[] = [];
    try {
      const items = await getOrderItems(client, o.orderId);
      lines = items.map((i) => ({
        sku: i.sku,
        quantity: i.quantity,
        unitPrice: i.quantity > 0 ? Math.max(0, i.itemPrice - i.promotionDiscount) / i.quantity : 0,
      }));
      // getOrderItems is hard-limited to ~0.5 req/s — pace bursts so a busy sweep can't 429.
      if (changed.length > 10) await new Promise((r) => setTimeout(r, 2100));
    } catch {
      // items unavailable (fresh Pending order) — keep the order, lines arrive on a later sweep
    }
    fetched.push({
      externalId: o.orderId,
      orderNumber: o.orderId,
      orderedAt: o.purchaseDate ? new Date(o.purchaseDate) : new Date(0),
      source: null,
      sourceLabel: null,
      status: o.status,
      cancelled: o.status === "Canceled",
      fulfillment: o.fulfillment === "AFN" ? "Amazon" : "Merchant",
      fulfillmentLabel: o.fulfillment === "AFN" ? "Amazon FBA" : "Merchant",
      total: o.total,
      currency: o.currency,
      lines,
    });
  }

  const result = await persist("AMAZON", fetched, (l) => (l.sku ? map.bySku.get(l.sku) ?? null : null));
  await saveOrgSettings({ ordersPollCursor: sweepStart.toISOString() });
  return { ...result, cursor: sweepStart.toISOString() };
}
