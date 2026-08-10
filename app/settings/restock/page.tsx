import { getAppSettings } from "@/app/settings/actions";
import { RestockSettings } from "@/components/RestockSettings";
import { requireView } from "@/lib/membership";

export const dynamic = "force-dynamic";

export default async function RestockSettingsPage() {
  await requireView("settings");
  const s = await getAppSettings();
  return (
    <RestockSettings
      initial={{
        defaultMinMonths: s.defaultMinMonths,
        defaultLeadMonths: s.defaultLeadMonths,
        shipDays: s.shipDays,
        shipBufferX: s.shipBufferX,
        defaultReorderTo: s.defaultReorderTo,
        defaultBatchSize: s.defaultBatchSize,
      }}
    />
  );
}
