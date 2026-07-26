import "server-only";
import { currentUserId, devAuthBypass } from "@/lib/current-user";
import { prismaBase } from "@/lib/prisma-base";
import { getCurrentOrgId } from "@/lib/tenant";

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
