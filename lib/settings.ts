import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * The current org's settings row (auto-scoped), creating an empty one on first use.
 *
 * Idempotent on purpose. A brand-new company's first page load fetches its dashboard data
 * concurrently, and several of those calls ask for settings; they all see "none yet" and all try
 * to create the row. One wins and the rest hit the unique constraint on orgId. Re-reading is the
 * right answer — the row the winner created is exactly the one we were about to make.
 */
export async function getOrgSettings() {
  const existing = await prisma.settings.findFirst();
  if (existing) return existing;
  try {
    return await prisma.settings.create({ data: {} }); // orgId + field defaults filled in
  } catch (e) {
    const raced = await prisma.settings.findFirst();
    if (raced) return raced;
    throw e;
  }
}

/** Update the current org's settings. */
export async function saveOrgSettings(data: Parameters<typeof prisma.settings.update>[0]["data"]) {
  const s = await getOrgSettings();
  return prisma.settings.update({ where: { id: s.id }, data });
}
