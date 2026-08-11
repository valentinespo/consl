"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { prismaBase } from "@/lib/prisma-base";
import { getCurrentOrgId } from "@/lib/tenant";
import { getCurrentOrg } from "@/lib/org";
import { requirePermission } from "@/lib/membership";
import { recomputeAll } from "@/lib/recompute";
import { syncAllChannelsCore } from "@/lib/sync";
import { refreshChannelListingsCore, autoMapExact, mappedExternalId, PRODUCT_MATCH_SELECT, type ChannelKey } from "@/lib/channel-catalog";

/**
 * The onboarding wizard's server side. The wizard is the ONLY thing a new company can see until
 * `completeOnboarding()` runs, so every forward move is validated here — the client's step state
 * is just a mirror of Organization.onboardingStep.
 *
 * Steps: 0 company details · 1 connect channels · 2 map SKUs + starting COG · 3 facilities +
 * finished starting balances · 4 raw materials · 5 raw starting balances · 6 finish (production).
 */

const PROVIDER_CHANNEL: Record<string, ChannelKey> = { shopify: "SHOPIFY", amazon: "AMAZON", tiktok: "TIKTOK" };
const LAST_STEP = 6;

async function setStep(step: number) {
  const orgId = await getCurrentOrgId();
  if (!orgId) return;
  await prismaBase.organization.update({
    where: { id: orgId },
    data: { onboardingStep: Math.max(0, Math.min(LAST_STEP, step)) },
  });
}

/** Go back (or re-open an earlier step). Never validated — backward is always safe. */
export async function backToStep(step: number) {
  const org = await getCurrentOrg();
  if (!org || org.onboardedAt) return { ok: false as const, error: "Onboarding is already finished." };
  if (step > org.onboardingStep) return { ok: false as const, error: "Use Continue to move forward." };
  await setStep(step);
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/**
 * Move forward one step, enforcing that step's exit conditions. Where fresh platform data makes
 * the NEXT step meaningful, it's pulled here (stock after connecting; stock again after mapping,
 * because Shopify/TikTok quantities only store once their SKUs resolve to products).
 */
export async function advanceOnboarding(opts?: { skipChannels?: boolean }) {
  const org = await getCurrentOrg();
  if (!org) return { ok: false as const, error: "No company open." };
  if (org.onboardedAt) return { ok: false as const, error: "Onboarding is already finished." };
  const step = org.onboardingStep;
  let warning: string | null = null;

  if (step === 0) {
    if (!org.name.trim() || !org.address?.trim() || !org.email?.trim()) {
      return { ok: false as const, error: "Fill in your company name, address and email before continuing." };
    }
  }

  if (step === 1) {
    const integrations = await prisma.integration.findMany({ where: { status: "connected" } });
    if (integrations.length === 0 && !opts?.skipChannels) {
      return { ok: false as const, error: "Connect at least one sales channel, or tick “I don't sell on any of these platforms” to continue." };
    }
    if (integrations.length > 0) warning = await pullChannelData(integrations.map((i) => i.provider));
  }

  if (step === 2) {
    const productCount = await prisma.product.count();
    if (productCount === 0) {
      return { ok: false as const, error: "Create at least one product (SKU) before continuing." };
    }
    const pending = await pendingListingCount();
    if (pending > 0) {
      return { ok: false as const, error: `${pending} listing${pending === 1 ? "" : "s"} still need${pending === 1 ? "s" : ""} a decision — map, import or ignore each one, then save.` };
    }
    const missingCost = await prisma.product.count({ where: { openingUnitCost: null } });
    if (missingCost > 0) {
      return { ok: false as const, error: `Enter an average cost of goods for every product (${missingCost} missing) — it prices your starting inventory.` };
    }
    // Mapping just landed, so Shopify/TikTok quantities can finally resolve to products — pull
    // stock again so the next step (and the final starting balances) see real channel counts.
    const integrations = await prisma.integration.findMany({ where: { status: "connected" } });
    if (integrations.length > 0) {
      const r = await syncAllChannelsCore().catch(() => null);
      if (r && r.failed.length > 0) warning = `Couldn't refresh ${r.failed.join(", ")} — the counts shown may be stale.`;
    }
  }

  await setStep(step + 1);
  revalidatePath("/", "layout");
  return { ok: true as const, warning };
}

/** Stock + catalog pull for freshly connected channels, so the mapping step has rows to show.
 *  Returns a warning string when part of it failed (never blocks the wizard). */
async function pullChannelData(providers: string[]): Promise<string | null> {
  const problems: string[] = [];
  const stock = await syncAllChannelsCore().catch(() => null);
  if (!stock) problems.push("stock");
  else if (stock.failed.length > 0) problems.push(...stock.failed);
  for (const p of providers) {
    const channel = PROVIDER_CHANNEL[p];
    if (!channel) continue;
    try {
      await refreshChannelListingsCore(channel);
      await autoMapExact(channel);
    } catch {
      problems.push(`${p} catalog`);
    }
  }
  return problems.length > 0 ? `Couldn't pull everything (${[...new Set(problems)].join(", ")}) — you can retry from the mapping step.` : null;
}

/** Listings still waiting on a decision (not ignored, not mapped), across every connected channel. */
async function pendingListingCount(): Promise<number> {
  const integrations = await prisma.integration.findMany({ where: { status: "connected" } });
  const channels = integrations.map((i) => PROVIDER_CHANNEL[i.provider]).filter(Boolean);
  if (channels.length === 0) return 0;
  const [listings, products] = await Promise.all([
    prisma.channelListing.findMany({ where: { channel: { in: channels }, ignored: false }, select: { channel: true, externalId: true } }),
    prisma.product.findMany({ select: PRODUCT_MATCH_SELECT }),
  ]);
  let pending = 0;
  for (const ch of channels) {
    const taken = new Set(products.map((p) => mappedExternalId(p, ch)).filter(Boolean));
    pending += listings.filter((l) => l.channel === ch && !taken.has(l.externalId)).length;
  }
  return pending;
}

/**
 * Wizard-only deletes — undoing something created a step ago. A facility or material may already
 * carry a starting balance; those OPENING rows are setup data, not history, so they're removed
 * with the record. Anything REAL (lots, purchases, POs, standard movements) still blocks deletion,
 * and neither action runs once the company is onboarded — the app's own guarded deletes take over.
 */
export async function deleteOnboardingFacility(id: string) {
  const gate = await requirePermission("facilities", "delete");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  const org = await getCurrentOrg();
  if (!org || org.onboardedAt) return { ok: false as const, error: "Only available during setup." };
  const facility = await prisma.facility.findFirst({ where: { id } });
  if (!facility) return { ok: false as const, error: "Facility not found" };
  if (facility.locked || facility.channel) {
    return { ok: false as const, error: "This facility belongs to a connected channel — disconnect the channel instead." };
  }
  const [lots, purchases, pos, realMoves] = await Promise.all([
    prisma.lot.count({ where: { facilityId: id } }),
    prisma.purchase.count({ where: { facilityId: id } }),
    prisma.purchaseOrder.count({ where: { facilityId: id } }),
    prisma.stockMovement.count({ where: { kind: { not: "OPENING" }, OR: [{ fromFacilityId: id }, { toFacilityId: id }] } }),
  ]);
  if (lots + purchases + pos + realMoves > 0) {
    return { ok: false as const, error: "This facility already has real activity and can't be deleted." };
  }
  const rawOpenings = await prisma.stockMovement.count({ where: { kind: "OPENING", itemType: "RAW", toFacilityId: id } });
  await prisma.stockMovement.deleteMany({ where: { kind: "OPENING", toFacilityId: id } });
  await prisma.facility.delete({ where: { id } });
  if (rawOpenings > 0) await recomputeAll();
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function deleteOnboardingMaterial(id: string) {
  const gate = await requirePermission("catalog", "delete");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  const org = await getCurrentOrg();
  if (!org || org.onboardedAt) return { ok: false as const, error: "Only available during setup." };
  const material = await prisma.materialType.findFirst({ where: { id } });
  if (!material) return { ok: false as const, error: "Material not found" };
  const [purchases, invoices, lotMaterials, realMoves] = await Promise.all([
    prisma.purchase.count({ where: { materialTypeId: id } }),
    prisma.purchaseInvoice.count({ where: { materialTypeId: id } }),
    prisma.lotMaterial.count({ where: { materialTypeId: id } }),
    prisma.stockMovement.count({ where: { materialTypeId: id, kind: { not: "OPENING" } } }),
  ]);
  if (purchases + invoices + lotMaterials + realMoves > 0) {
    return { ok: false as const, error: "This material already has real activity and can't be deleted." };
  }
  const openings = await prisma.stockMovement.count({ where: { kind: "OPENING", materialTypeId: id } });
  await prisma.stockMovement.deleteMany({ where: { kind: "OPENING", materialTypeId: id } });
  await prisma.materialType.delete({ where: { id } });
  if (openings > 0) await recomputeAll();
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Save the per-SKU average COG for starting balances (wizard step 2's second half). */
export async function saveOpeningCosts(entries: { productId: string; cost: number | null }[]) {
  const gate = await requirePermission("catalog", "edit");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  const own = new Set((await prisma.product.findMany({ select: { id: true } })).map((p) => p.id));
  let saved = 0;
  for (const e of entries) {
    if (!own.has(e.productId)) continue;
    const cost = e.cost == null || Number.isNaN(Number(e.cost)) ? null : Math.max(0, Number(e.cost));
    await prisma.product.update({ where: { id: e.productId }, data: { openingUnitCost: cost } });
    saved++;
  }
  revalidatePath("/", "layout");
  return { ok: true as const, saved };
}

/**
 * Finish onboarding: mint the day-zero layers for stock sitting AT the sales channels (from the
 * counts the platforms report right now, at each SKU's starting COG), then unlock the app.
 *
 * The claim is conditional on `onboardedAt` still being null, so a double-click can't create the
 * channel layers twice. Facility starting balances were already written step by step.
 */
export async function completeOnboarding() {
  const gate = await requirePermission("settings", "manage");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  const orgId = await getCurrentOrgId();
  if (!orgId) return { ok: false as const, error: "No company open." };

  const claimed = await prismaBase.organization.updateMany({
    where: { id: orgId, onboardedAt: null },
    data: { onboardedAt: new Date(), onboardingStep: LAST_STEP },
  });
  if (claimed.count === 0) {
    revalidatePath("/", "layout");
    return { ok: true as const, channelLayers: 0 }; // already finished (double submit)
  }

  const [products, snaps, channelHeld] = await Promise.all([
    prisma.product.findMany({ select: { id: true, openingUnitCost: true } }),
    prisma.skuSnapshot.findMany({ distinct: ["productId"], orderBy: { capturedAt: "desc" } }),
    prisma.channelStock.findMany({
      where: { units: { gt: 0 } },
      select: { productId: true, units: true, facility: { select: { channel: true } } },
    }),
  ]);
  const costById = new Map(products.map((p) => [p.id, p.openingUnitCost ?? 0]));

  // Everything Amazon reports holding (FBA incl. inbound/reserved + AWD) is one AMAZON pool.
  const openings: { productId: string; destination: string; units: number }[] = [];
  for (const s of snaps) {
    if (!costById.has(s.productId)) continue;
    const units = s.fbaTotal + s.awdOnhand + s.awdInbound;
    if (units > 0) openings.push({ productId: s.productId, destination: "AMAZON", units });
  }
  // Shopify/TikTok: one pool per channel — locations summed, matching how they're valued.
  const perChannel = new Map<string, number>();
  for (const c of channelHeld) {
    const ch = c.facility.channel;
    if (ch !== "SHOPIFY" && ch !== "TIKTOK" || !costById.has(c.productId)) continue;
    const k = `${ch}|${c.productId}`;
    perChannel.set(k, (perChannel.get(k) ?? 0) + c.units);
  }
  for (const [k, units] of perChannel) {
    const [destination, productId] = [k.slice(0, k.indexOf("|")), k.slice(k.indexOf("|") + 1)];
    openings.push({ productId, destination, units });
  }

  for (const o of openings) {
    await prisma.stockMovement.create({
      data: {
        kind: "OPENING",
        itemType: "FINISHED",
        productId: o.productId,
        quantity: o.units,
        unitCost: costById.get(o.productId) ?? 0,
        date: new Date(),
        toDestination: o.destination,
        notes: "Starting balance",
      },
    });
  }

  revalidatePath("/", "layout");
  return { ok: true as const, channelLayers: openings.length };
}
