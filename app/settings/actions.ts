"use server";

import { prisma } from "@/lib/prisma";
import { getOrgSettings, saveOrgSettings } from "@/lib/settings";
import { syncAmazonCore } from "@/lib/sync";
import { getRestock } from "@/lib/restock";
import { revalidatePath } from "next/cache";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));

/** Current app settings for the settings panel. */
export async function getAppSettings() {
  const s = await getOrgSettings();
  return {
    syncEnabled: s.syncEnabled,
    syncHour: s.syncHour,
    syncMinute: s.syncMinute,
    syncTz: s.syncTz,
    lastSyncAt: s.lastSyncAt ? s.lastSyncAt.toISOString() : null,
    defaultMinMonths: s.defaultMinMonths,
    defaultLeadMonths: s.defaultLeadMonths,
  };
}

/** Save the automatic-sync schedule + restock defaults from the settings panel. */
export async function saveSettings(input: {
  syncEnabled: boolean;
  syncHour: number;
  syncMinute: number;
  syncTz: string;
  defaultMinMonths: number;
  defaultLeadMonths: number;
}) {
  const data = {
    syncEnabled: !!input.syncEnabled,
    syncHour: clamp(input.syncHour, 0, 23),
    syncMinute: clamp(input.syncMinute, 0, 59),
    syncTz: input.syncTz.trim() || "America/Argentina/Buenos_Aires",
    defaultMinMonths: Math.max(0, input.defaultMinMonths) || 5,
    defaultLeadMonths: Math.max(0, input.defaultLeadMonths) || 4.5,
  };
  await saveOrgSettings(data);
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Dismiss a dashboard notification (re-appears if the condition recurs after resolving). */
export async function dismissNotification(key: string) {
  const existing = await prisma.dismissedNotification.findFirst({ where: { key } });
  if (!existing) await prisma.dismissedNotification.create({ data: { key } });
  revalidatePath("/");
  return { ok: true as const };
}

/** Persist the dashboard widget layout (array of { id, x, y, w, h }). */
export async function saveDashboardLayout(layout: { id: string; x: number; y: number; w: number; h: number }[]) {
  await saveOrgSettings({ dashboardLayout: layout });
  return { ok: true as const };
}

/** Manual "Run now" from the settings panel: sync Amazon + record the value snapshot immediately. */
export async function runSyncNow() {
  try {
    const r = await syncAmazonCore();
    if (r.ok) {
      await getRestock();
      await saveOrgSettings({ lastSyncAt: new Date() });
    }
    revalidatePath("/");
    revalidatePath("/inventory");
    return r;
  } catch (e) {
    return { ok: false as const, error: (e as Error).message };
  }
}
