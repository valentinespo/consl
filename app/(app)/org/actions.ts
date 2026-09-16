"use server";

import { revalidatePath } from "next/cache";
import { prismaBase } from "@/lib/prisma-base";
import { currentUserId, devAuthBypass } from "@/lib/current-user";
import { setActiveOrgCookie } from "@/lib/active-org";

/**
 * Switch which of your companies is open.
 *
 * Membership is re-checked here rather than trusted from the client: the cookie decides what the
 * whole app reads, so setting it is exactly as sensitive as the data behind it.
 */
export async function switchOrg(orgId: string) {
  // Local dev has no session to check a membership against; allow any existing company.
  if (devAuthBypass) {
    const exists = await prismaBase.organization.findUnique({ where: { id: orgId }, select: { id: true } });
    if (!exists) return { ok: false as const, error: "That company no longer exists." };
    await setActiveOrgCookie(orgId);
    revalidatePath("/", "layout");
    return { ok: true as const };
  }

  const userId = await currentUserId();
  if (!userId) return { ok: false as const, error: "You're not signed in." };

  const member = await prismaBase.membership.findFirst({
    where: { clerkUserId: userId, orgId },
    select: { id: true },
  });
  if (!member) return { ok: false as const, error: "You're not a member of that company." };

  await setActiveOrgCookie(orgId);
  revalidatePath("/", "layout");
  return { ok: true as const };
}
