import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Custom order fees — costs consl can't see on any channel's ledger, attached per order.
 *
 * Two ways in: a RULE (every order it matches gets the fee, recomputed whenever the rule or the
 * order changes) and a fee written BY HAND on one order or a selection. A rule's criteria are
 * ANDed — channel, the Shopify source that created the order, how it was paid, where it was
 * fulfilled (after any manual override), or a tag the Orders tab already pins on rows (MCF, free
 * sample, …) — and it charges a flat amount per order, or a share of what the customer paid plus
 * an optional flat amount on top (PayPal's 3.49% + $0.49 is one rule).
 *
 * When a rule applies: from its creation on (the default), to the whole past as well, or only to
 * orders placed inside a period. Each fee lands in the P&L bucket the rule chose — "Custom fees",
 * or "Payment processing" for a processor's charge — under the rule's own name.
 */

/** Tags a rule can target — the same flags the Orders tab pins on a row. */
export const FEE_TAGS: Record<string, string> = { mcf: "MCF", free_sample: "Free sample", replacement: "Replacement", free_unit: "Free unit" };
export type FeeKind = "fixed" | "percent";
export type FeeBucket = "custom_fees" | "payment_fees";
export const FEE_BUCKETS: FeeBucket[] = ["custom_fees", "payment_fees"];

type Rule = {
  id: string; name: string; kind: string; value: number; extraFixed: number | null; bucket: string;
  channel: string | null; source: string | null; paymentMethod: string | null; facilityId: string | null; tag: string | null;
  appliesToPast: boolean; periodFrom: Date | null; periodTo: Date | null; active: boolean; createdAt: Date;
};
type Order = {
  id: string; channel: string; source: string | null; paymentMethod: string | null; fulfillmentFacilityId: string | null; fulfillmentOverrideFacilityId: string | null;
  mcf: boolean; replacement: boolean; total: number; cancelled: boolean; status: string | null; orderedAt: Date;
};

const ORDER_SELECT = {
  id: true, channel: true, source: true, paymentMethod: true, fulfillmentFacilityId: true, fulfillmentOverrideFacilityId: true,
  mcf: true, replacement: true, total: true, cancelled: true, status: true, orderedAt: true,
} as const;

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** The Orders tab's row tags, from the same rules it uses. */
export function orderTags(o: Order): Set<string> {
  const tags = new Set<string>();
  if (o.mcf) tags.add("mcf");
  if (o.replacement) tags.add("replacement");
  if (o.channel === "TIKTOK" && o.total === 0 && !o.cancelled) tags.add("free_sample");
  if (o.channel === "AMAZON" && o.total === 0 && !o.mcf && !o.replacement && !o.cancelled && (o.status === "Shipped" || o.status === "PartiallyShipped")) tags.add("free_unit");
  return tags;
}

/** The facility the order counts as fulfilled from: the operator's correction, else the detected one. */
export const effectiveFacilityId = (o: { fulfillmentFacilityId: string | null; fulfillmentOverrideFacilityId: string | null }) =>
  o.fulfillmentOverrideFacilityId ?? o.fulfillmentFacilityId;

export function ruleMatches(rule: Rule, o: Order): boolean {
  if (!rule.active) return false;
  // When: a period beats everything; otherwise from the rule's creation, or the whole past.
  if (rule.periodFrom && o.orderedAt < rule.periodFrom) return false;
  if (rule.periodTo && o.orderedAt > rule.periodTo) return false;
  if (!rule.periodFrom && !rule.periodTo && !rule.appliesToPast && o.orderedAt < rule.createdAt) return false;
  if (rule.channel && o.channel !== rule.channel) return false;
  if (rule.source && (o.source ?? "").toLowerCase() !== rule.source.toLowerCase()) return false;
  if (rule.paymentMethod && (o.paymentMethod ?? "") !== rule.paymentMethod) return false;
  if (rule.facilityId && effectiveFacilityId(o) !== rule.facilityId) return false;
  if (rule.tag && !orderTags(o).has(rule.tag)) return false;
  return true;
}

/** What a fee charges on an order: a flat amount, or a share of what the customer paid plus an
 *  optional flat amount on top. */
export function feeAmount(kind: string, value: number, orderTotal: number, extraFixed: number | null = null): number {
  return kind === "percent" ? round2((orderTotal * value) / 100 + (extraFixed ?? 0)) : round2(value);
}

const bucketOf = (b: string | null | undefined): FeeBucket => (b === "payment_fees" ? "payment_fees" : "custom_fees");

/** Recompute the rule-written fees on these orders from today's rules; hand-written fees stay. */
export async function applyFeeRulesToOrders(orderIds: string[]): Promise<number> {
  if (orderIds.length === 0) return 0;
  const rules = await prisma.orderFeeRule.findMany({ where: { active: true } });
  const existing = await prisma.orderFee.findMany({
    where: { orderId: { in: orderIds }, ruleId: { not: null } },
    select: { id: true, orderId: true, ruleId: true, amount: true, name: true, bucket: true },
  });
  if (rules.length === 0 && existing.length === 0) return 0;
  const orders = await prisma.salesOrder.findMany({ where: { id: { in: orderIds } }, select: ORDER_SELECT });
  const toDelete: string[] = [];
  const toCreate: { orderId: string; ruleId: string; name: string; amount: number; bucket: FeeBucket }[] = [];
  for (const o of orders) {
    const want = new Map(
      rules
        .filter((r) => ruleMatches(r, o))
        .map((r) => [r.id, { orderId: o.id, ruleId: r.id, name: r.name, amount: feeAmount(r.kind, r.value, o.total, r.extraFixed), bucket: bucketOf(r.bucket) }]),
    );
    for (const f of existing.filter((e) => e.orderId === o.id)) {
      const w = want.get(f.ruleId as string);
      if (w && w.amount === f.amount && w.name === f.name && w.bucket === f.bucket) want.delete(f.ruleId as string);
      else toDelete.push(f.id);
    }
    toCreate.push(...want.values());
  }
  if (toDelete.length) await prisma.orderFee.deleteMany({ where: { id: { in: toDelete } } });
  if (toCreate.length) await prisma.orderFee.createMany({ data: toCreate });
  return toDelete.length + toCreate.length;
}

/** Rewrite one rule's fees across every order it covers (the whole past, or its period, when it says so). */
export async function applyFeeRule(ruleId: string): Promise<number> {
  const rule = await prisma.orderFeeRule.findFirst({ where: { id: ruleId } });
  if (!rule) return 0;
  await prisma.orderFee.deleteMany({ where: { ruleId } });
  if (!rule.active) return 0;
  // Narrow the walk to what the rule can match; ruleMatches() still has the final say per order.
  const period = rule.periodFrom || rule.periodTo;
  const where = {
    ...(rule.channel ? { channel: rule.channel } : {}),
    ...(rule.source ? { source: { equals: rule.source, mode: "insensitive" as const } } : {}),
    ...(rule.paymentMethod ? { paymentMethod: rule.paymentMethod } : {}),
    ...(rule.facilityId
      ? { OR: [{ fulfillmentOverrideFacilityId: rule.facilityId }, { fulfillmentOverrideFacilityId: null, fulfillmentFacilityId: rule.facilityId }] }
      : {}),
    ...(rule.tag === "mcf" ? { mcf: true } : {}),
    ...(rule.tag === "replacement" ? { replacement: true } : {}),
    ...(rule.tag === "free_sample" ? { channel: "TIKTOK", total: 0 } : {}),
    ...(rule.tag === "free_unit" ? { channel: "AMAZON", total: 0 } : {}),
    ...(period
      ? { orderedAt: { ...(rule.periodFrom ? { gte: rule.periodFrom } : {}), ...(rule.periodTo ? { lte: rule.periodTo } : {}) } }
      : rule.appliesToPast
        ? {}
        : { orderedAt: { gte: rule.createdAt } }),
  };
  const bucket = bucketOf(rule.bucket);
  let created = 0;
  for (let skip = 0; ; skip += 2000) {
    const batch = await prisma.salesOrder.findMany({ where, select: ORDER_SELECT, orderBy: { id: "asc" }, skip, take: 2000 });
    const data = batch
      .filter((o) => ruleMatches(rule, o))
      .map((o) => ({ orderId: o.id, ruleId, name: rule.name, amount: feeAmount(rule.kind, rule.value, o.total, rule.extraFixed), bucket }));
    if (data.length) {
      await prisma.orderFee.createMany({ data });
      created += data.length;
    }
    if (batch.length < 2000) break;
  }
  return created;
}
