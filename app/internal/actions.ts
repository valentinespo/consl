"use server";

import { revalidatePath } from "next/cache";
import { prismaBase } from "@/lib/prisma-base";
import { requireSuperuser } from "@/lib/superuser";
import { setActiveOrgCookie } from "@/lib/active-org";

/** Enable (or take back) the "Start 14-day free trial" button on a company's waiting screen —
 *  what the brand manager does during the discovery call. */
export async function setTrialUnlocked(orgId: string, unlocked: boolean) {
  const guard = await requireSuperuser();
  if (!guard.ok) return guard;
  const org = await prismaBase.organization.findFirst({ where: { id: orgId, deactivatedAt: null }, select: { id: true } });
  if (!org) return { ok: false as const, error: "That company no longer exists." };
  await prismaBase.organization.update({ where: { id: orgId }, data: { trialUnlockedAt: unlocked ? new Date() : null } });
  revalidatePath("/internal", "layout");
  return { ok: true as const };
}

/** Open a company as the admin: sets the active-company cookie; the client then reloads into it. */
export async function openCompany(orgId: string) {
  const guard = await requireSuperuser();
  if (!guard.ok) return guard;
  const org = await prismaBase.organization.findFirst({ where: { id: orgId, deactivatedAt: null }, select: { id: true } });
  if (!org) return { ok: false as const, error: "That company no longer exists." };
  await setActiveOrgCookie(orgId);
  return { ok: true as const };
}
