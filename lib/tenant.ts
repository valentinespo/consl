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
 * Resolve the logged-in user's org from their membership (cached per request).
 *
 * A user with no membership gets no org, and every tenant query then fails closed. There is
 * deliberately no auto-join: a "first user claims the seed org" bootstrap would hand the whole
 * dataset to whoever signs up next any time an org is left with zero members — which is exactly
 * the state after a database restore, a staging clone, or a deleted membership row.
 * Memberships are created explicitly (org creation / invite), never inferred from signing in.
 */
const orgIdFromAuth = cache(async (): Promise<string | null> => {
  const { userId } = await auth();
  if (!userId) return null;
  const existing = await prismaBase.membership.findFirst({
    where: { clerkUserId: userId },
    orderBy: { createdAt: "asc" }, // stable pick until there's an org switcher
  });
  return existing?.orgId ?? null;
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
  if (process.env.NODE_ENV === "development" && process.env.ALLOW_DEV_AUTH_BYPASS === "1") {
    return process.env.DEV_ORG_ID ?? null;
  }
  return await orgIdFromAuth();
}

/** Warm the per-request org lookup (called from the layout on every authenticated load). */
export async function ensureMembership(): Promise<void> {
  await getCurrentOrgId();
}
