import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/org";
import { listMyOrgs } from "@/lib/orgs";
import { currentRole, getMyAccess } from "@/lib/membership";
import { RESOURCE_KEYS, actionsOf } from "@/lib/permissions";
import { getOrgSettings } from "@/lib/settings";
import { getMaterialTypes } from "@/lib/queries";
import { PROVIDERS, type Provider } from "@/lib/integrations";
import { amazonOAuthConfigured } from "@/lib/amazon-oauth";
import { shopifyOAuthConfigured } from "@/lib/shopify-oauth";
import { tiktokConfigured } from "@/lib/tiktok";
import { CHANNEL_TITLES, PRODUCT_MATCH_SELECT, mappedExternalId, suggestMappings, type ChannelKey } from "@/lib/channel-catalog";
import { OnboardingWizard, type WizardMapping } from "@/components/onboarding/OnboardingWizard";

export const dynamic = "force-dynamic";

const PROVIDER_CHANNEL: Record<string, ChannelKey> = { shopify: "SHOPIFY", amazon: "AMAZON", tiktok: "TIKTOK" };
const CHANNEL_TAB_LOGO: Record<ChannelKey, string> = {
  SHOPIFY: "/integrations/shopify.png",
  AMAZON: "/integrations/amazon-fba.png",
  TIKTOK: "/integrations/tiktok.png",
};

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

  const [role, orgs, settings, integrations, products, facilities, materials, openingMovs, snaps, channelHeld, access] =
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

  // ---- Step 3: what each connected channel reports holding (recorded as day-zero layers on finish) ----
  const codeById = new Map(products.map((p) => [p.id, p.code]));
  const channelCounts: { channel: string; label: string; skus: { code: string; units: number }[] }[] = [];
  if (connected.has("amazon")) {
    const skus = snaps
      .map((s) => ({ code: codeById.get(s.productId) ?? "?", units: s.fbaTotal + Math.max(0, s.awdOnhand - s.awdReserved) + s.awdInbound }))
      .filter((s) => s.units > 0 && s.code !== "?")
      .sort((a, b) => b.units - a.units);
    channelCounts.push({ channel: "AMAZON", label: "Amazon (FBA + AWD)", skus });
  }
  for (const [ch, label] of [
    ["SHOPIFY", "Shopify"],
    ["TIKTOK", "TikTok Shop"],
  ] as const) {
    if (!channels.includes(ch)) continue;
    const perSku = new Map<string, number>();
    for (const c of channelHeld) {
      if (c.facility.channel !== ch) continue;
      const code = codeById.get(c.productId);
      if (code) perSku.set(code, (perSku.get(code) ?? 0) + c.units);
    }
    channelCounts.push({
      channel: ch,
      label,
      skus: [...perSku.entries()].map(([code, units]) => ({ code, units })).sort((a, b) => b.units - a.units),
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

  // Which steps actually hold saved content — a visited-ahead step only stays lit (and clickable)
  // on the rail when something was really saved there; untouched defaults dim like unvisited.
  const ownFacCount = facilities.filter((f) => !f.channel).length;
  const stepHasContent = [
    true, // 0 — company details always exist
    integrations.length > 0,
    products.length > 0,
    ownFacCount > 0 || openingMovs.some((m) => m.itemType === "FINISHED"),
    materials.length > 0,
    openingMovs.some((m) => m.itemType === "RAW"),
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
