import "server-only";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

/**
 * Resolve the current logged-in user's organization (tenant).
 * Bootstrap: the first user to ever sign in claims the seed org (Herbl) as owner.
 * Once an org has any member, new users no longer auto-join it — so no data leaks.
 */
export async function getCurrentOrgId(): Promise<string | null> {
  const { userId } = await auth();
  if (!userId) return null;

  const existing = await prisma.membership.findFirst({ where: { clerkUserId: userId } });
  if (existing) return existing.orgId;

  // No membership yet — claim the seed org if it's still unclaimed.
  const herbl = await prisma.organization.findUnique({ where: { slug: "herbl" } });
  if (herbl) {
    const members = await prisma.membership.count({ where: { orgId: herbl.id } });
    if (members === 0) {
      const m = await prisma.membership.create({ data: { clerkUserId: userId, orgId: herbl.id, role: "owner" } });
      return m.orgId;
    }
  }
  return null;
}

/** Ensure the current user has a membership (runs the bootstrap). Safe to call on every request. */
export async function ensureMembership(): Promise<void> {
  await getCurrentOrgId();
}
