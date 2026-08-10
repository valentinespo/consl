import { getAppSettings } from "@/app/settings/actions";
import { TimezoneSettings } from "@/components/TimezoneSettings";
import { requireView } from "@/lib/membership";

export const dynamic = "force-dynamic";

export default async function TimezoneSettingsPage() {
  await requireView("settings");
  const s = await getAppSettings();
  return <TimezoneSettings initialTz={s.syncTz} lastSyncAt={s.lastSyncAt} />;
}
