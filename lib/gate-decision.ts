import { prismaBase } from "@/lib/prisma-base";
import { needsBillingGate } from "@/lib/billing";

/**
 * Where a request must be sent instead of the page it asked for, decided BEFORE anything renders.
 *
 * This runs in the middleware (see middleware.ts), which answers with a plain HTTP redirect.
 * Next's router follows those natively on client-side navigations, so a gated company never gets
 * the dashboard's tree, never mounts the app chrome, and never enters the render-phase redirect
 * race that crashed the router on 2026-09-16. Plain module: no React `cache`, no `cookies()`.
 *
 * Rules, in order: signed in with no company → the application; company whose trial hasn't started
 * (early access) → the waiting screen; company that hasn't finished the setup wizard → the wizard.
 */

/** Paths that are never gated: auth, marketing, the application flow, the waiting screen, the
 *  company setup pages, machine endpoints and file serving. */
const EXEMPT = ["/api", "/media", "/uploads", "/connect", "/welcome", "/join", "/pre-onboarding", "/sign-in", "/sign-up", "/home", "/apply", "/privacy", "/terms"];

export function isGateExempt(pathname: string): boolean {
  return EXEMPT.some((p) => pathname === p || pathname.startsWith(p + "/") || pathname.startsWith(p + "?"));
}

export type GateInput = {
  pathname: string;
  /** Clerk user id, or null when nobody is signed in (or the local-dev bypass is on). */
  userId: string | null;
  /** The company the browser last selected (the active-org cookie), unverified. */
  cookieOrgId: string | null;
  /** Local-dev bypass: resolve the company the way the app does without a session. */
  devBypass: boolean;
};

export async function gateDecision(input: GateInput): Promise<string | null> {
  const { pathname, userId, cookieOrgId, devBypass } = input;
  if (isGateExempt(pathname)) return null;

  let orgId: string | null = null;
  if (userId) {
    const memberships = await prismaBase.membership.findMany({
      where: { clerkUserId: userId, organization: { deactivatedAt: null } },
      select: { orgId: true },
      orderBy: { createdAt: "asc" },
    });
    // An early-access applicant whose company was never created (or was removed) belongs back in
    // the application, where the account step creates and links it — not on the generic company form.
    if (memberships.length === 0) return "/apply";
    orgId = cookieOrgId && memberships.some((m) => m.orgId === cookieOrgId) ? cookieOrgId : memberships[0].orgId;
  } else if (devBypass) {
    if (cookieOrgId) {
      const exists = await prismaBase.organization.findUnique({ where: { id: cookieOrgId }, select: { id: true } });
      if (exists) orgId = cookieOrgId;
    }
    orgId ??= process.env.DEV_ORG_ID ?? null;
  }
  if (!orgId) return null;

  const org = await prismaBase.organization.findUnique({
    where: { id: orgId },
    select: { billingExempt: true, subscriptionStatus: true, onboardedAt: true },
  });
  if (!org) return null;
  if (needsBillingGate(org)) return "/pre-onboarding";
  if (!org.onboardedAt && !pathname.startsWith("/onboarding")) return "/onboarding";
  return null;
}
