"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, requireView } from "@/lib/membership";
import { importAllOrders } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { applyFeeRule, applyFeeRulesToOrders, feeAmount, FEE_TAGS, FEE_BUCKETS, type FeeKind, type FeeBucket } from "@/lib/order-fees";
import { getOrgSettings } from "@/lib/settings";
import { zonedDayBounds } from "@/lib/pnl";

/** Pull orders from every connected channel into the store. Idempotent — safe to re-run; it
 *  backfills new orders and refreshes changed ones. Gated on inventory:edit like the other syncs. */
export async function importOrders() {
  const gate = await requirePermission("inventory", "edit");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  try {
    const results = await importAllOrders();
    revalidatePath("/orders");
    const done = results.filter((r) => !r.error && r.orders > 0).map((r) => `${r.channel} ${r.orders}`);
    const failed = results.filter((r) => r.error).map((r) => r.channel);
    return {
      ok: failed.length === 0,
      summary: done.length ? done.join(", ") : "no new orders",
      error: failed.length ? `Some channels couldn't be reached.` : undefined,
    };
  } catch (e) {
    console.error("[importOrders]", e);
    return { ok: false as const, error: "The import couldn't complete. Please try again." };
  }
}

const touched = () => {
  revalidatePath("/orders");
  revalidatePath("/pnl");
};

/** Void/unvoid orders from the row menu or the bulk bar — the only writer of `voided`; imports never touch it. */
export async function setOrdersVoided(ids: string[], voided: boolean) {
  const gate = await requirePermission("inventory", "edit");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  await prisma.salesOrder.updateMany({ where: { id: { in: ids } }, data: { voided, voidedManual: true } });
  touched();
  return { ok: true as const };
}

/** Kept for the row menu: one order. */
export async function setOrderVoided(id: string, voided: boolean) {
  return setOrdersVoided([id], voided);
}

type FeeInput = { name: string; kind: FeeKind; value: number; extraFixed?: number | null; bucket?: FeeBucket };

function checkFee(fee: FeeInput): string | null {
  const name = fee.name.trim();
  if (!name) return "Give the fee a name.";
  if (name.length > 60) return "Keep the name under 60 characters.";
  if (!Number.isFinite(fee.value) || fee.value <= 0) return "Enter an amount above zero.";
  if (fee.kind === "percent" && fee.value > 100) return "A percentage can't exceed 100.";
  if (fee.kind !== "percent" && fee.kind !== "fixed") return "Choose a fee type.";
  if (fee.extraFixed != null && (!Number.isFinite(fee.extraFixed) || fee.extraFixed < 0)) return "The flat amount on top can't be negative.";
  if (fee.bucket && !FEE_BUCKETS.includes(fee.bucket)) return "Choose where the fee shows on the P&L.";
  return null;
}

/** A flat amount on top only means something on a percentage; a fixed fee IS the flat amount. */
const extraOf = (fee: FeeInput) => (fee.kind === "percent" && fee.extraFixed ? fee.extraFixed : null);
const bucketOf = (fee: FeeInput): FeeBucket => fee.bucket ?? "custom_fees";

/** Write a fee by hand onto one order or a selection. A percentage is of what each customer paid. */
export async function addOrderFees(orderIds: string[], fee: FeeInput) {
  const gate = await requirePermission("inventory", "edit");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  const bad = checkFee(fee);
  if (bad) return { ok: false as const, error: bad };
  const orders = await prisma.salesOrder.findMany({ where: { id: { in: orderIds } }, select: { id: true, total: true } });
  if (orders.length === 0) return { ok: false as const, error: "No orders selected." };
  await prisma.orderFee.createMany({
    data: orders.map((o) => ({ orderId: o.id, ruleId: null, name: fee.name.trim(), amount: feeAmount(fee.kind, fee.value, o.total, extraOf(fee)), bucket: bucketOf(fee) })),
  });
  touched();
  return { ok: true as const, count: orders.length };
}

export async function removeOrderFee(feeId: string) {
  const gate = await requirePermission("inventory", "edit");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  await prisma.orderFee.deleteMany({ where: { id: feeId } });
  touched();
  return { ok: true as const };
}

/** Correct which facility orders shipped from — one from its dialog, or a selection at once.
 *  Null clears the correction. Fee rules keyed on the facility follow the correction. */
export async function setFulfillmentOverrides(orderIds: string[], facilityId: string | null) {
  const gate = await requirePermission("inventory", "edit");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  if (facilityId && !(await prisma.facility.findFirst({ where: { id: facilityId }, select: { id: true } }))) return { ok: false as const, error: "Pick a facility." };
  await prisma.salesOrder.updateMany({ where: { id: { in: orderIds } }, data: { fulfillmentOverrideFacilityId: facilityId } });
  await applyFeeRulesToOrders(orderIds);
  touched();
  return { ok: true as const };
}

export async function setFulfillmentOverride(orderId: string, facilityId: string | null) {
  return setFulfillmentOverrides([orderId], facilityId);
}

type RuleInput = FeeInput & {
  channel: string | null;
  source: string | null;
  paymentMethod: string | null;
  facilityId: string | null;
  tag: string | null;
  /** "all": past and future · "from": orders placed on `period.from` or later · "period": orders placed inside `period`. */
  scope: "all" | "from" | "period";
  period?: { from: string; to: string | null } | null; // company-calendar days, YYYY-MM-DD
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Create a rule and write it onto every order it covers (the past, or its period, when asked). */
export async function createFeeRule(input: RuleInput) {
  const gate = await requirePermission("inventory", "edit");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  const bad = checkFee(input);
  if (bad) return { ok: false as const, error: bad };
  if (input.channel && !["AMAZON", "SHOPIFY", "TIKTOK"].includes(input.channel)) return { ok: false as const, error: "Unknown channel." };
  if (input.tag && !FEE_TAGS[input.tag]) return { ok: false as const, error: "Unknown tag." };
  if (input.facilityId && !(await prisma.facility.findFirst({ where: { id: input.facilityId }, select: { id: true } }))) return { ok: false as const, error: "Pick a facility." };
  let period: { from: Date; to: Date | null } | null = null;
  if (input.scope === "period") {
    const p = input.period;
    if (!p || !DAY.test(p.from) || !p.to || !DAY.test(p.to)) return { ok: false as const, error: "Pick the first and last day the rule covers." };
    if (p.from > p.to) return { ok: false as const, error: "The period ends before it starts." };
    period = zonedDayBounds(p.from, p.to, (await getOrgSettings()).syncTz);
  } else if (input.scope === "from") {
    const p = input.period;
    if (!p || !DAY.test(p.from)) return { ok: false as const, error: "Pick the day the rule starts." };
    period = { from: zonedDayBounds(p.from, p.from, (await getOrgSettings()).syncTz).from, to: null };
  } else if (input.scope !== "all") return { ok: false as const, error: "Choose which orders the rule covers." };
  const rule = await prisma.orderFeeRule.create({
    data: {
      name: input.name.trim(),
      kind: input.kind,
      value: input.value,
      extraFixed: extraOf(input),
      bucket: bucketOf(input),
      channel: input.channel || null,
      source: input.source?.trim() || null,
      paymentMethod: input.paymentMethod?.trim() || null,
      facilityId: input.facilityId || null,
      tag: input.tag || null,
      appliesToPast: input.scope === "all",
      periodFrom: period?.from ?? null,
      periodTo: period?.to ?? null,
    },
  });
  const count = await applyFeeRule(rule.id);
  touched();
  return { ok: true as const, count };
}

export async function deleteFeeRule(id: string) {
  const gate = await requirePermission("inventory", "edit");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  await prisma.orderFeeRule.deleteMany({ where: { id } }); // its fees go with it (cascade)
  touched();
  return { ok: true as const };
}

/** Pause or resume a rule — its fees are removed, or written again, at once. */
export async function setFeeRuleActive(id: string, active: boolean) {
  const gate = await requirePermission("inventory", "edit");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  await prisma.orderFeeRule.updateMany({ where: { id }, data: { active } });
  await applyFeeRule(id);
  touched();
  return { ok: true as const };
}

/** Whether any channel is connected — controls whether the Orders tab offers an import. */
export async function anyChannelConnected() {
  await requireView("dashboard");
  const conns = await (await import("@/lib/prisma")).prisma.integration.count({
    where: { status: "connected", provider: { in: ["amazon", "shopify", "tiktok"] } },
  });
  return conns > 0;
}
