import { getAppSettings } from "@/app/settings/actions";
import { SyncSettings } from "@/components/SyncSettings";

export const dynamic = "force-dynamic";

export default async function SyncSettingsPage() {
  const settings = await getAppSettings();
  return <SyncSettings initial={settings} />;
}
