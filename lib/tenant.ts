import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { cache } from "react";
import { auth } from "@clerk/nextjs/server";
import { prismaBase } from "@/lib/prisma-base";

// Explicit org context for background jobs / scripts (no logged-in user).
const orgStore = new AsyncLocalStorage<{ orgId: string }>();

/** Run `fn` with an explicit org in context — used by the scheduler and scripts. */
export function runWithOrg<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
  return orgStore.run({ orgId }, fn);
}

/**
 * Resolve the logged-in user's org (cached per request so the membership lookup runs once).
 * Bootstrap: the first user to ever sign in claims the seed org (Herbl) as owner; once an
 * org has any member, new users no longer auto-join it.
 */
const orgIdFromAuth = cache(async (): Promise<string | null> => {
  const { userId } = await auth();
  if (!userId) return null;

  const existing = await prismaBase.membership.findFirst({ where: { clerkUserId: userId } });
  if (existing) return existing.orgId;

  const herbl = await prismaBase.organization.findUnique({ where: { slug: "herbl" } });
  if (herbl) {
    const members = await prismaBase.membership.count({ where: { orgId: herbl.id } });
    if (members === 0) {
      const m = await prismaBase.membership.create({ data: { clerkUserId: userId, orgId: herbl.id, role: "owner" } });
      return m.orgId;
    }
  }
  return null;
});

/** The current org — an explicit background context if set, otherwise the logged-in user's org. */
export async function getCurrentOrgId(): Promise<string | null> {
  return orgStore.getStore()?.orgId ?? (await orgIdFromAuth());
}

/** Force the bootstrap to run (called from the layout on every authenticated load). */
export async function ensureMembership(): Promise<void> {
  await getCurrentOrgId();
}
