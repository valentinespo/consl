import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { currentUserId, devAuthBypass } from "@/lib/current-user";
import { prismaBase } from "@/lib/prisma-base";
import { getCurrentOrgId } from "@/lib/tenant";
import { can, normalizePermissions, type Action, type Resource } from "@/lib/permissions";

/**
 * Who the signed-in user is inside their company.
 *
 * Membership is deliberately read through the UNSCOPED client: it is a cross-tenant table (it is
 * what decides which tenant you are), so it can't be filtered by the tenant it defines.
 */

export type Role = "owner" | "member";

/** The signed-in user's role in the current org, or null when they aren't in one. */
export async function currentRole(): Promise<Role | null> {
  const userId = await currentUserId();
  const orgId = await getCurrentOrgId();
  // Local dev bypass: there is no Clerk session, but the developer is working *as* the dev org.
  // Reporting "no role" would hide every owner-only control and make local dev misleading.
  if (devAuthBypass && orgId) return "owner";
  if (!userId || !orgId) return null;
  const m = await prismaBase.membership.findFirst({
    where: { clerkUserId: userId, orgId },
    select: { role: true },
  });
  return m ? ((m.role === "owner" ? "owner" : "member") as Role) : null;
}

/** Guard for actions only an owner may perform (managing the team, deleting the company). */
export async function requireOwner(): Promise<{ ok: true; orgId: string; userId: string } | { ok: false; error: string }> {
  const userId = await currentUserId();
  const orgId = await getCurrentOrgId();
  // Same local-dev allowance as currentRole, so owner-only actions are testable without a login.
  if (devAuthBypass && orgId) return { ok: true, orgId, userId: userId ?? "dev-user" };
  if (!userId || !orgId) return { ok: false, error: "You're not signed in to a company." };
  const m = await prismaBase.membership.findFirst({ where: { clerkUserId: userId, orgId }, select: { role: true } });
  if (!m) return { ok: false, error: "You're not a member of this company." };
  if (m.role !== "owner") return { ok: false, error: "Only an owner can do that." };
  return { ok: true, orgId, userId };
}

/**
 * The signed-in member's role + effective permissions in the current org. Wrapped in cache() so
 * the one membership read is shared across the layout, the page, and any server action in a single
 * request. Owners get full access; members get their stored grants (or the default baseline).
 */
export type MyAccess = {
  role: Role;
  orgId: string;
  userId: string;
  can: (r: Resource, a: Action) => boolean;
};

export const getMyAccess = cache(async (): Promise<MyAccess | null> => {
  const userId = await currentUserId();
  const orgId = await getCurrentOrgId();
  if (devAuthBypass && orgId) return { role: "owner", orgId, userId: userId ?? "dev-user", can: () => true };
  if (!userId || !orgId) return null;
  const m = await prismaBase.membership.findFirst({
    where: { clerkUserId: userId, orgId },
    select: { role: true, permissions: true },
  });
  if (!m) return null;
  const role: Role = m.role === "owner" ? "owner" : "member";
  const perms = role === "owner" ? null : normalizePermissions(m.permissions);
  return { role, orgId, userId, can: (r, a) => can(role, perms, r, a) };
});

/**
 * Guard for a mutating server action: returns ok only when the caller may take `action` on
 * `resource`. Owners always pass. Mirrors requireOwner's shape so call sites read the same way.
 */
export async function requirePermission(
  resource: Resource,
  action: Action,
): Promise<{ ok: true; orgId: string; userId: string } | { ok: false; error: string }> {
  const access = await getMyAccess();
  if (!access) return { ok: false, error: "You're not signed in to a company." };
  if (!access.can(resource, action)) return { ok: false, error: "You don't have permission to do that." };
  return { ok: true, orgId: access.orgId, userId: access.userId };
}

/**
 * Page guard: a member who can't view a section shouldn't be able to reach its URL directly. Fails
 * closed to a 404 (rather than leaking that the page exists). The sidebar already hides the link;
 * this is the enforcement behind it.
 */
export async function requireView(resource: Resource): Promise<void> {
  const access = await getMyAccess();
  if (!access || !access.can(resource, "view")) notFound();
}
