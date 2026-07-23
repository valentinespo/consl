import "server-only";
import { prisma } from "@/lib/prisma";

/** The current org's settings row (auto-scoped), creating an empty one on first use. */
export async function getOrgSettings() {
  const existing = await prisma.settings.findFirst();
  if (existing) return existing;
  return prisma.settings.create({ data: {} }); // orgId + field defaults filled in
}

/** Update the current org's settings. */
export async function saveOrgSettings(data: Parameters<typeof prisma.settings.update>[0]["data"]) {
  const s = await getOrgSettings();
  return prisma.settings.update({ where: { id: s.id }, data });
}
