"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/membership";
import { saveOrgSettings } from "@/lib/settings";

export async function saveLtvSettings(input: { overrides: Record<string, boolean> }) {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  if (!input || !input.overrides || typeof input.overrides !== "object" || Array.isArray(input.overrides) || Object.keys(input.overrides).length > 300 || Object.entries(input.overrides).some(([k, v]) => k.length > 250 || typeof v !== "boolean")) return { ok: false as const, error: "Choose valid LTV settings." };
  try {
    await saveOrgSettings({ ltvExcludedChannels: input.overrides });
    revalidatePath("/ltv");
    return { ok: true as const };
  } catch {
    return { ok: false as const, error: "The settings could not be saved. Please try again." };
  }
}
