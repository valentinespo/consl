import "server-only";
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
 * The signed-in member's role + effective permissions in the current org, resolved once per
 * request. Owners get full access; members get their stored grants (or the default baseline).
 */
export type MyAccess = { role: Role; can: (r: Resource, a: Action) => boolean };

export async function getMyAccess(): Promise<MyAccess | null> {
  const userId = await currentUserId();
  const orgId = await getCurrentOrgId();
  if (devAuthBypass && orgId) return { role: "owner", can: () => true };
  if (!userId || !orgId) return null;
  const m = await prismaBase.membership.findFirst({
    where: { clerkUserId: userId, orgId },
    select: { role: true, permissions: true },
  });
  if (!m) return null;
  const role: Role = m.role === "owner" ? "owner" : "member";
  const perms = role === "owner" ? null : normalizePermissions(m.permissions);
  return { role, can: (r, a) => can(role, perms, r, a) };
}

/**
 * Guard for a mutating server action: returns ok only when the caller may take `action` on
 * `resource`. Owners always pass. Mirrors requireOwner's shape so call sites read the same way.
 */
export async function requirePermission(
  resource: Resource,
  action: Action,
): Promise<{ ok: true; orgId: string; userId: string } | { ok: false; error: string }> {
  const userId = await currentUserId();
  const orgId = await getCurrentOrgId();
  if (devAuthBypass && orgId) return { ok: true, orgId, userId: userId ?? "dev-user" };
  if (!userId || !orgId) return { ok: false, error: "You're not signed in to a company." };
  const m = await prismaBase.membership.findFirst({
    where: { clerkUserId: userId, orgId },
    select: { role: true, permissions: true },
  });
  if (!m) return { ok: false, error: "You're not a member of this company." };
  const role: Role = m.role === "owner" ? "owner" : "member";
  const perms = role === "owner" ? null : normalizePermissions(m.permissions);
  if (!can(role, perms, resource, action)) {
    return { ok: false, error: "You don't have permission to do that." };
  }
  return { ok: true, orgId, userId };
}
