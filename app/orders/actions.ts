"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, requireView } from "@/lib/membership";
import { importAllOrders } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { applyFeeRule, applyFeeRulesToOrders, feeAmount, FEE_TAGS, type FeeKind } from "@/lib/order-fees";

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

type FeeInput = { name: string; kind: FeeKind; value: number };

function checkFee(fee: FeeInput): string | null {
  const name = fee.name.trim();
  if (!name) return "Give the fee a name.";
  if (name.length > 60) return "Keep the name under 60 characters.";
  if (!Number.isFinite(fee.value) || fee.value <= 0) return "Enter an amount above zero.";
  if (fee.kind === "percent" && fee.value > 100) return "A percentage can't exceed 100.";
  if (fee.kind !== "percent" && fee.kind !== "fixed") return "Choose a fee type.";
  return null;
}

/** Write a fee by hand onto one order or a selection. A percentage is of what each customer paid. */
export async function addOrderFees(orderIds: string[], fee: FeeInput) {
  const gate = await requirePermission("inventory", "edit");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  const bad = checkFee(fee);
  if (bad) return { ok: false as const, error: bad };
  const orders = await prisma.salesOrder.findMany({ where: { id: { in: orderIds } }, select: { id: true, total: true } });
  if (orders.length === 0) return { ok: false as const, error: "No orders selected." };
  await prisma.orderFee.createMany({
    data: orders.map((o) => ({ orderId: o.id, ruleId: null, name: fee.name.trim(), amount: feeAmount(fee.kind, fee.value, o.total) })),
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

/** Correct where an order shipped from. Null clears the correction. Fee rules keyed on the
 *  location follow the correction. */
export async function setFulfillmentOverride(orderId: string, label: string | null) {
  const gate = await requirePermission("inventory", "edit");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  const clean = label?.trim() || null;
  if (clean && clean.length > 80) return { ok: false as const, error: "Keep the location under 80 characters." };
  await prisma.salesOrder.updateMany({ where: { id: orderId }, data: { fulfillmentOverride: clean } });
  await applyFeeRulesToOrders([orderId]);
  touched();
  return { ok: true as const };
}

type RuleInput = FeeInput & { channel: string | null; source: string | null; fulfilledAt: string | null; tag: string | null; appliesToPast: boolean };

/** Create a rule and write it onto every order it covers (the past too when asked). */
export async function createFeeRule(input: RuleInput) {
  const gate = await requirePermission("inventory", "edit");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  const bad = checkFee(input);
  if (bad) return { ok: false as const, error: bad };
  if (input.channel && !["AMAZON", "SHOPIFY", "TIKTOK"].includes(input.channel)) return { ok: false as const, error: "Unknown channel." };
  if (input.tag && !FEE_TAGS[input.tag]) return { ok: false as const, error: "Unknown tag." };
  const rule = await prisma.orderFeeRule.create({
    data: {
      name: input.name.trim(),
      kind: input.kind,
      value: input.value,
      channel: input.channel || null,
      source: input.source?.trim() || null,
      fulfilledAt: input.fulfilledAt?.trim() || null,
      tag: input.tag || null,
      appliesToPast: input.appliesToPast,
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
