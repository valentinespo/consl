import "server-only";
import { cache } from "react";
import { prismaBase } from "@/lib/prisma-base";
import { currentUserId, devAuthBypass } from "@/lib/current-user";
import { getCurrentOrgId } from "@/lib/tenant";

export type MyOrg = { id: string; name: string; role: string; active: boolean };

/**
 * Every company the signed-in user can open, for the switcher. Read on the unscoped client:
 * Membership is what decides the tenant, so it can't be filtered by one.
 */
export const listMyOrgs = cache(async (): Promise<MyOrg[]> => {
  const activeId = await getCurrentOrgId();

  // Local dev has no Clerk session and therefore no memberships to filter by, so every company is
  // listed. That makes the switcher exercisable locally; it cannot happen on a deployment.
  if (devAuthBypass) {
    const all = await prismaBase.organization.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
    return all.map((o) => ({ id: o.id, name: o.name, role: "owner", active: o.id === activeId }));
  }

  const userId = await currentUserId();
  if (!userId) return [];

  const memberships = await prismaBase.membership.findMany({
    where: { clerkUserId: userId },
    select: { orgId: true, role: true, organization: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });

  return memberships
    .filter((m) => m.organization)
    .map((m) => ({
      id: m.organization!.id,
      name: m.organization!.name,
      role: m.role,
      active: m.organization!.id === activeId,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
});
