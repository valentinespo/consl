import Link from "next/link";
import { Plug } from "@/components/icons";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui";
import { EmptyState } from "@/components/EmptyState";
import { requireView } from "@/lib/membership";
import { CHANNEL_TITLES, PRODUCT_MATCH_SELECT, mappedExternalId, suggestMappings, type ChannelKey } from "@/lib/channel-catalog";
import { ChannelMappingClient } from "@/components/ChannelMappingClient";

export const dynamic = "force-dynamic";

const PROVIDER_CHANNEL: Record<string, ChannelKey> = { shopify: "SHOPIFY", amazon: "AMAZON", tiktok: "TIKTOK" };
const CHANNEL_TAB_LOGO: Record<ChannelKey, string> = {
  SHOPIFY: "/integrations/shopify.png",
  AMAZON: "/integrations/amazon-fba.png",
  TIKTOK: "/integrations/tiktok.png",
};

export default async function MappingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireView("catalog");
  const sp = await searchParams;

  const integrations = await prisma.integration.findMany({
    where: { status: "connected", provider: { in: ["shopify", "amazon", "tiktok"] } },
    orderBy: { connectedAt: "asc" },
  });
  const channels = integrations.map((i) => PROVIDER_CHANNEL[i.provider]).filter(Boolean);

  if (channels.length === 0) {
    return (
      <>
        <PageHeader title="Product mapping" subtitle="Link each channel listing to the consl product it sells." />
        <EmptyState icon={Plug} title="No sales channel connected" body="Connect Amazon or Shopify first — their catalogs appear here for mapping.">
          <Link href="/settings/integrations" className="rounded-lg bg-ink px-3 py-1.5 text-[12.5px] font-medium text-bg hover:opacity-90">
            Open integrations
          </Link>
        </EmptyState>
      </>
    );
  }

  const requested = typeof sp.channel === "string" ? (sp.channel.toUpperCase() as ChannelKey) : null;
  const channel: ChannelKey = requested && channels.includes(requested) ? requested : channels[0];
  const justConnected = sp.connected === "1";

  const [listings, products] = await Promise.all([
    prisma.channelListing.findMany({ where: { channel }, orderBy: { title: "asc" } }),
    prisma.product.findMany({ select: { ...PRODUCT_MATCH_SELECT, imageUrl: true }, orderBy: { code: "asc" } }),
  ]);

  const byExternal = new Map(products.map((p) => [mappedExternalId(p, channel), p]));
  const pending = listings.filter((l) => !l.ignored && !byExternal.has(l.externalId));
  const suggestions = suggestMappings(channel, pending, products);

  const rows = listings.map((l) => {
    const mapped = byExternal.get(l.externalId) ?? null;
    const suggestion = suggestions.get(l.id) ?? null;
    return {
      id: l.id,
      title: l.title,
      sku: l.sku,
      imageUrl: l.imageUrl,
      price: l.price,
      ignored: l.ignored,
      mapped: mapped ? { id: mapped.id, code: mapped.code, name: mapped.name, imageUrl: mapped.imageUrl } : null,
      suggestion,
    };
  });

  const pickerProducts = products.map((p) => {
    const taken = mappedExternalId(p, channel);
    return { id: p.id, code: p.code, name: p.name, takenExternalId: taken };
  });

  return (
    <>
      <PageHeader
        title="Product mapping"
        subtitle="Link each channel listing to the consl product it sells — its sales and stock flow into that product."
      />
      <ChannelMappingClient
        channel={channel}
        tabs={channels.map((c) => ({ key: c, title: CHANNEL_TITLES[c], logo: CHANNEL_TAB_LOGO[c] }))}
        rows={rows}
        products={pickerProducts}
        justConnected={justConnected}
      />
    </>
  );
}
