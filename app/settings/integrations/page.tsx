import { Plug } from "@/components/icons";
import { EmptyState } from "@/components/EmptyState";
import { requireView } from "@/lib/membership";

export const dynamic = "force-dynamic";

/** Integrations — deliberately empty for now; the per-channel OAuth connections (Amazon SP-API,
 *  Shopify, TikTok Shop, …) will land here. */
export default async function IntegrationsSettingsPage() {
  await requireView("settings");
  return (
    <EmptyState
      icon={Plug}
      title="No integrations yet"
      body="Connections to your sales channels — Amazon, Shopify, TikTok Shop — will live here. Coming soon."
    />
  );
}
