import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/org";
import { listMyOrgs } from "@/lib/orgs";
import { currentRole, getMyAccess } from "@/lib/membership";
import { RESOURCE_KEYS, actionsOf } from "@/lib/permissions";
import { getOrgSettings } from "@/lib/settings";
import { getMaterialTypes, getLotOptions, getSupplierNames, getProductImageMap, getCategoriesInUse, getTransactionInvoices } from "@/lib/queries";
import { buildCostChips } from "@/lib/lot-costs";
import type { EditorLine } from "@/components/LotEditor";
import { PROVIDERS, type Provider } from "@/lib/integrations";
import { amazonOAuthConfigured } from "@/lib/amazon-oauth";
import { shopifyOAuthConfigured } from "@/lib/shopify-oauth";
import { tiktokConfigured } from "@/lib/tiktok";
import { CHANNEL_TITLES, PRODUCT_MATCH_SELECT, mappedExternalId, suggestMappings, type ChannelKey } from "@/lib/channel-catalog";
import { ROOT_LOGO, PROVIDER_LOGO } from "@/lib/channel-logos";
import { OnboardingWizard, type WizardMapping, type WizardLot } from "@/components/onboarding/OnboardingWizard";
import { readOnboardingJob } from "@/lib/onboarding-jobs";

export const dynamic = "force-dynamic";

const PROVIDER_CHANNEL: Record<string, ChannelKey> = { shopify: "SHOPIFY", amazon: "AMAZON", tiktok: "TIKTOK" };
// Tabs name a whole channel — the shared root marks (Amazon's smile, not the FBA badge).
const CHANNEL_TAB_LOGO = ROOT_LOGO;

/** The setup wizard — the only page a not-yet-onboarded company can reach (the root layout
 *  redirects every other path here until `completeOnboarding()` unlocks the app). */
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // No explicit session check: the middleware already walls this route off for signed-out
  // visitors, and the local-dev bypass (no Clerk) must still be able to render it.
  const org = await getCurrentOrg();
  if (!org) redirect("/welcome");
  if (org.onboardedAt) redirect("/");
  const sp = await searchParams;

  const [role, orgs, settings, integrations, products, facilities, materials, openingMovs, snaps, channelHeld, access, job] =
    await Promise.all([
      currentRole(),
      listMyOrgs().catch(() => []),
      getOrgSettings(),
      prisma.integration.findMany({ where: { status: "connected" } }),
      prisma.product.findMany({ orderBy: { code: "asc" } }),
      prisma.facility.findMany({ orderBy: { code: "asc" } }),
      getMaterialTypes(),
      prisma.stockMovement.findMany({ where: { kind: "OPENING" } }),
      prisma.skuSnapshot.findMany({ distinct: ["productId"], orderBy: { capturedAt: "desc" } }),
      prisma.channelStock.findMany({
        where: { units: { gt: 0 } },
        select: { productId: true, units: true, facility: { select: { channel: true } } },
      }),
      getMyAccess().catch(() => null),
      readOnboardingJob(),
    ]);

  const connected = new Set(integrations.map((i) => i.provider));
  // Step 1's button: a connection newer than the last wizard pull means data is waiting to be
  // pulled; otherwise coming back through the step is a plain Continue (nothing is redone).
  const pulledAt = settings.onboardingPulledAt ?? null;
  const channelsPullPending = integrations.some((i) => !pulledAt || !i.connectedAt || i.connectedAt > pulledAt);
  const canConnect: Record<Provider, boolean> = {
    amazon: amazonOAuthConfigured(),
    shopify: shopifyOAuthConfigured(),
    tiktok: tiktokConfigured(),
  };
  const providers = (Object.keys(PROVIDERS) as Provider[]).map((p) => ({
    key: p,
    label: PROVIDERS[p].label,
    blurb: PROVIDERS[p].blurb,
    logo: PROVIDER_LOGO[p],
    connected: connected.has(p),
    canConnect: canConnect[p],
  }));

  // ---- Step 2: the mapping worklist for the active channel tab, same build as /catalog/mapping ----
  const channels = integrations.map((i) => PROVIDER_CHANNEL[i.provider]).filter(Boolean);
  let mapping: WizardMapping = null;
  if (channels.length > 0) {
    const requested = typeof sp.channel === "string" ? (sp.channel.toUpperCase() as ChannelKey) : null;
    const channel: ChannelKey = requested && channels.includes(requested) ? requested : channels[0];
    const listings = await prisma.channelListing.findMany({ where: { channel: { in: channels } }, orderBy: { title: "asc" } });

    // Unmapped = not linked to a product (ignored or not) — matches the merged worklist.
    const pendingByChannel: Record<string, number> = {};
    for (const ch of channels) {
      const taken = new Set(products.map((p) => mappedExternalId(p, ch)).filter(Boolean));
      pendingByChannel[ch] = listings.filter((l) => l.channel === ch && !taken.has(l.externalId)).length;
    }

    const active = listings.filter((l) => l.channel === channel);
    const byExternal = new Map(products.map((p) => [mappedExternalId(p, channel), p]));
    const pendingRows = active.filter((l) => !l.ignored && !byExternal.has(l.externalId));
    const suggestions = suggestMappings(channel, pendingRows, products);
    mapping = {
      channel,
      tabs: channels.map((c) => ({ key: c, title: CHANNEL_TITLES[c], logo: CHANNEL_TAB_LOGO[c] })),
      rows: active.map((l) => {
        const mapped = byExternal.get(l.externalId) ?? null;
        return {
          id: l.id,
          title: l.title,
          sku: l.sku,
          imageUrl: l.imageUrl,
          price: l.price,
          ignored: l.ignored,
          mapped: mapped ? { id: mapped.id, code: mapped.code, name: mapped.name, imageUrl: mapped.imageUrl } : null,
          suggestion: suggestions.get(l.id) ?? null,
        };
      }),
      pickerProducts: products.map((p) => ({ id: p.id, code: p.code, name: p.name, imageUrl: p.imageUrl, takenExternalId: mappedExternalId(p, channel) })),
      pendingByChannel,
    };
  }

  // ---- Step 3: what each connected channel reports holding (recorded as day-zero layers on finish),
  // priced at the starting cost entered in step 2 — the same cost those layers will carry. ----
  const codeById = new Map(products.map((p) => [p.id, p.code]));
  const costById = new Map(products.map((p) => [p.id, p.openingUnitCost]));
  const priced = (productId: string, units: number) => {
    const cost = costById.get(productId) ?? null;
    return { units, value: cost != null ? units * cost : null };
  };
  const channelCounts: { channel: string; label: string; skus: { code: string; units: number; value: number | null }[] }[] = [];
  if (connected.has("amazon")) {
    const skus = snaps
      .map((s) => ({ code: codeById.get(s.productId) ?? "?", ...priced(s.productId, s.fbaTotal + Math.max(0, s.awdOnhand - s.awdReserved) + s.awdInbound) }))
      .filter((s) => s.units > 0 && s.code !== "?")
      .sort((a, b) => b.units - a.units);
    channelCounts.push({ channel: "AMAZON", label: "Amazon (FBA + AWD)", skus });
  }
  for (const [ch, label] of [
    ["SHOPIFY", "Shopify"],
    ["TIKTOK", "TikTok Shop"],
  ] as const) {
    if (!channels.includes(ch)) continue;
    const perSku = new Map<string, { productId: string; units: number }>();
    for (const c of channelHeld) {
      if (c.facility.channel !== ch) continue;
      const code = codeById.get(c.productId);
      if (code) perSku.set(code, { productId: c.productId, units: (perSku.get(code)?.units ?? 0) + c.units });
    }
    channelCounts.push({
      channel: ch,
      label,
      skus: [...perSku.entries()].map(([code, x]) => ({ code, ...priced(x.productId, x.units) })).sort((a, b) => b.units - a.units),
    });
  }

  // ---- Prefills: starting balances already saved (wizard grids are edit-in-place) ----
  const finishedOpenings: Record<string, Record<string, number>> = {};
  const rawOpenings: Record<string, { materialTypeId: string; productId: string | null; quantity: number; unitCost: number }[]> = {};
  for (const m of openingMovs) {
    if (!m.toFacilityId) continue;
    if (m.itemType === "FINISHED" && m.productId) {
      (finishedOpenings[m.toFacilityId] ??= {})[m.productId] = m.quantity;
    } else if (m.itemType === "RAW" && m.materialTypeId) {
      (rawOpenings[m.toFacilityId] ??= []).push({
        materialTypeId: m.materialTypeId,
        productId: m.productId,
        quantity: m.quantity,
        unitCost: m.unitCost ?? 0,
      });
    }
  }

  const caps = access
    ? Object.fromEntries(RESOURCE_KEYS.map((r) => [r, actionsOf(r).filter((a) => access.can(r, a))]))
    : null;

  // ---- Step 5: production runs already under way, edited with the app's own lot editor and costed
  // with its own transaction forms — so the wizard shows exactly what the lot page will. ----
  const lots = await prisma.lot.findMany({
    include: { lines: { include: { product: true, materials: true }, orderBy: { seq: "asc" } } },
    orderBy: { lotNr: "asc" },
  });
  const [lotOptions, suppliers, skuImages, categories] = lots.length
    ? await Promise.all([getLotOptions(), getSupplierNames(), getProductImageMap(), getCategoriesInUse()])
    : [[], [], {}, []];
  const matName = (code: string) => materials.find((m) => m.code === code)?.name ?? code;
  const wizardLots: WizardLot[] = [];
  for (const lot of lots) {
    const invoices = await getTransactionInvoices(lot.id);
    const skuTxnCounts: Record<string, number> = {};
    for (const inv of invoices)
      for (const line of inv.lines) if (line.lotId === lot.id && line.sku && line.appliesToCog) skuTxnCounts[line.sku] = (skuTxnCounts[line.sku] ?? 0) + 1;
    const initialLines: EditorLine[] = lot.lines.map((ln) => ({
      id: ln.id,
      productId: ln.productId,
      code: ln.product.code,
      name: ln.product.name,
      imageUrl: ln.product.imageUrl,
      units: ln.units,
      status: ln.status,
      paymentStatus: ln.paymentStatus === "PAID" ? "PAID" : "DUE",
      finishedAtISO: ln.finishedAt ? ln.finishedAt.toISOString().slice(0, 10) : null,
      expiryISO: ln.expiryAt ? ln.expiryAt.toISOString().slice(0, 10) : null,
      batchNr: ln.batchNr,
      materials: ln.materials.map((m) => ({ materialTypeId: m.materialTypeId, perUnit: m.perUnit })),
      costs: buildCostChips(ln.materialCostsJson, ln.transactionCostsJson, ln.shortfallsJson, matName),
      cogPerUnit: ln.cogPerUnit,
      shortfalls: JSON.parse(ln.shortfallsJson),
    }));
    wizardLots.push({
      id: lot.id,
      lotNr: lot.lotNr,
      updatedAt: lot.updatedAt.toISOString(),
      initial: { poNumber: lot.poNumber, poDateISO: lot.poDate ? lot.poDate.toISOString().slice(0, 10) : null, facilityId: lot.facilityId, notes: lot.notes },
      initialLines,
      skuTxnCounts,
      totalCog: lot.lines.reduce((t, l) => t + l.cogPerUnit * l.units, 0),
      invoices,
    });
  }
  const nextLotNr = lots.reduce((m, l) => Math.max(m, l.lotNr), 0) + 1;
  const inProdLines = lots.flatMap((l) => l.lines.filter((ln) => ln.status === "IN_PRODUCTION").map((ln) => ({ ln, facilityId: l.facilityId })));
  // Material a lot has already drawn from a facility's counted stock — netted out of that
  // facility's raw slice on Finish, so the widget's total counts it once, inside the lot.
  const rawConsumedByFacility: Record<string, number> = {};
  const lineMaterialCost = (json: string) => {
    try {
      return Object.values(JSON.parse(json) as Record<string, number>).reduce((t, v) => t + (Number(v) || 0), 0);
    } catch {
      return 0;
    }
  };
  for (const { ln, facilityId } of inProdLines) {
    rawConsumedByFacility[facilityId] = (rawConsumedByFacility[facilityId] ?? 0) + lineMaterialCost(ln.materialCostsJson) * ln.units;
  }
  const inProduction = {
    lots: lots.filter((l) => l.lines.some((ln) => ln.status === "IN_PRODUCTION")).length,
    units: inProdLines.reduce((t, { ln }) => t + ln.units, 0),
    value: inProdLines.reduce((t, { ln }) => t + ln.cogPerUnit * ln.units, 0),
    rawConsumedByFacility,
  };

  // Which steps actually hold saved content — a visited-ahead step only stays lit (and clickable)
  // on the rail when something was really saved there; untouched defaults dim like unvisited.
  const ownFacCount = facilities.filter((f) => !f.channel).length;
  const stepHasContent = [
    true, // 0 — company details always exist
    integrations.length > 0,
    products.length > 0,
    ownFacCount > 0 || openingMovs.some((m) => m.itemType === "FINISHED"),
    materials.length > 0 || openingMovs.some((m) => m.itemType === "RAW"), // 4 — materials & their stock
    lots.length > 0, // 5 — production in progress
    false, // 6 — Finish saves nothing until it runs
  ];

  return (
    <OnboardingWizard
      step={org.onboardingStep}
      maxStep={org.onboardingMaxStep}
      stepHasContent={stepHasContent}
      company={{
        name: org.name,
        legalName: org.legalName,
        address: org.address,
        email: org.email,
        phone: org.phone,
        currencySymbol: org.currencySymbol,
        currencyCode: org.currencyCode,
        locale: org.locale,
        brandInk: org.brandInk,
        brandBand: org.brandBand,
        logoUrl: org.logoUrl,
        iconUrl: org.iconUrl,
      }}
      isOwner={role === "owner"}
      caps={caps}
      orgs={orgs}
      currency={{ symbol: org.currencySymbol, locale: org.locale, code: org.currencyCode }}
      syncTz={settings.syncTz}
      job={job}
      lotEditing={{ lots: wizardLots, lotOptions, suppliers, categories, skuImages, materialTypes: materials, nextLotNr }}
      inProduction={inProduction}
      providers={providers}
      channelsPullPending={channelsPullPending}
      mapping={mapping}
      products={products.map((p) => ({ id: p.id, code: p.code, name: p.name, imageUrl: p.imageUrl, openingUnitCost: p.openingUnitCost }))}
      facilities={facilities.map((f) => ({ id: f.id, code: f.code, name: f.name, type: f.type, channel: f.channel, locked: f.locked }))}
      channelCounts={channelCounts}
      materials={materials.map((m) => ({ id: m.id, code: m.code, name: m.name, unitLabel: m.unitLabel, skuSpecific: m.skuSpecific }))}
      finishedOpenings={finishedOpenings}
      rawOpenings={rawOpenings}
    />
  );
}
