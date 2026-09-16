import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { prismaBase } from "@/lib/prisma-base";
import { INTERNAL_ORG_ID, isSuperuserId } from "@/lib/superuser-ids";
import { currentUserId, devAuthBypass } from "@/lib/current-user";
import { getCurrentOrgId } from "@/lib/tenant";

/** role: owner | member for a membership; "superuser" for a company the admin may open without one;
 *  "internal" for the pinned internal-area entry. */
export type MyOrg = { id: string; name: string; role: string; active: boolean; iconUrl: string | null };

const INTERNAL_ENTRY = { id: INTERNAL_ORG_ID, name: "consl internal", iconUrl: "/brand/consl-mark.png", role: "internal" };

/** Whether this request is for the internal area (the middleware passes the path through). */
async function onInternalPath(): Promise<boolean> {
  try {
    const p = (await headers()).get("x-pathname") ?? "";
    return p === "/internal" || p.startsWith("/internal/");
  } catch {
    return false;
  }
}

/**
 * Every company the signed-in user can open, for the switcher. Read on the unscoped client:
 * Membership is what decides the tenant, so it can't be filtered by one.
 */
export const listMyOrgs = cache(async (): Promise<MyOrg[]> => {
  const activeId = await getCurrentOrgId();

  // Local dev has no Clerk session and therefore no memberships to filter by, so every company is
  // listed. That makes the switcher exercisable locally; it cannot happen on a deployment.
  if (devAuthBypass) {
    const all = await prismaBase.organization.findMany({
      where: { deactivatedAt: null },
      select: { id: true, name: true, iconUrl: true },
      orderBy: { name: "asc" },
    });
    const internal = await onInternalPath();
    return [
      { ...INTERNAL_ENTRY, active: internal },
      ...all.map((o) => ({ id: o.id, name: o.name, iconUrl: o.iconUrl, role: "owner", active: !internal && o.id === activeId })),
    ];
  }

  const userId = await currentUserId();
  if (!userId) return [];

  // The admin account sees the internal area pinned on top, then every live company.
  if (isSuperuserId(userId)) {
    const internal = await onInternalPath();
    const all = await prismaBase.organization.findMany({
      where: { deactivatedAt: null },
      select: { id: true, name: true, iconUrl: true },
      orderBy: { name: "asc" },
    });
    return [
      { ...INTERNAL_ENTRY, active: internal },
      ...all.map((o) => ({ id: o.id, name: o.name, iconUrl: o.iconUrl, role: "superuser", active: !internal && o.id === activeId })),
    ];
  }

  const memberships = await prismaBase.membership.findMany({
    where: { clerkUserId: userId, organization: { deactivatedAt: null } },
    select: { orgId: true, role: true, organization: { select: { id: true, name: true, iconUrl: true } } },
    orderBy: { createdAt: "asc" },
  });

  return memberships
    .filter((m) => m.organization)
    .map((m) => ({
      id: m.organization!.id,
      name: m.organization!.name,
      iconUrl: m.organization!.iconUrl,
      role: m.role,
      active: m.organization!.id === activeId,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
});
