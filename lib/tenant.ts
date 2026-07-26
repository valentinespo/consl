import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { cache } from "react";
import { auth } from "@clerk/nextjs/server";
import { prismaBase } from "@/lib/prisma-base";
import { readActiveOrgCookie } from "@/lib/active-org";
import { devAuthBypass } from "@/lib/current-user";

// Explicit org context for background jobs / scripts (no logged-in user).
const orgStore = new AsyncLocalStorage<{ orgId: string }>();

/** Run `fn` with an explicit org in context — used by the scheduler and scripts. */
export function runWithOrg<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
  return orgStore.run({ orgId }, fn);
}

/**
 * Resolve which company the logged-in user is currently working in (cached per request).
 *
 * A user can belong to several. The active-org cookie says which one is open; it is honoured only
 * when a matching membership still exists, so a stale or forged cookie can't reach a company they
 * were removed from. With no usable cookie, fall back to their oldest membership.
 *
 * A user with no membership at all gets no org, and every tenant query then fails closed. There is
 * deliberately no auto-join: a "first user claims the seed org" bootstrap would hand the whole
 * dataset to whoever signs up next any time an org is left with zero members — which is exactly
 * the state after a database restore, a staging clone, or a deleted membership row.
 */
const orgIdFromAuth = cache(async (): Promise<string | null> => {
  const { userId } = await auth();
  if (!userId) return null;

  const memberships = await prismaBase.membership.findMany({
    where: { clerkUserId: userId },
    select: { orgId: true },
    orderBy: { createdAt: "asc" },
  });
  if (memberships.length === 0) return null;

  const selected = await readActiveOrgCookie();
  if (selected && memberships.some((m) => m.orgId === selected)) return selected;
  return memberships[0].orgId;
});

/**
 * The current org — an explicit background context if set, otherwise the logged-in user's org.
 * Local-dev escape hatch: with ALLOW_DEV_AUTH_BYPASS=1 and a DEV_ORG_ID set (both only ever
 * present in a developer's own .env), unauthenticated requests resolve to that org so the app can
 * be run locally without a login. Gated on the explicit flag, not NODE_ENV alone, so a preview
 * environment or a mistaken start command cannot silently disable tenancy.
 */
export async function getCurrentOrgId(): Promise<string | null> {
  const explicit = orgStore.getStore()?.orgId;
  if (explicit) return explicit;
  if (devAuthBypass) {
    // There's no Clerk session to own a selection, so the cookie is taken at face value — but only
    // for organizations that actually exist, so a stale cookie can't wedge the app.
    const selected = await readActiveOrgCookie();
    if (selected) {
      const exists = await prismaBase.organization.findUnique({ where: { id: selected }, select: { id: true } });
      if (exists) return selected;
    }
    return process.env.DEV_ORG_ID ?? null;
  }
  return await orgIdFromAuth();
}

/** Warm the per-request org lookup (called from the layout on every authenticated load). */
export async function ensureMembership(): Promise<void> {
  await getCurrentOrgId();
}
