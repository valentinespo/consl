import { getAppSettings } from "@/app/settings/actions";
import { SyncSettings } from "@/components/SyncSettings";
import { requireView } from "@/lib/membership";

export const dynamic = "force-dynamic";

export default async function SyncSettingsPage() {
  await requireView("settings");
  const settings = await getAppSettings();
  return <SyncSettings initial={settings} />;
}
