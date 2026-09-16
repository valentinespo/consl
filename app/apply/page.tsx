import type { Metadata } from "next";
import { ApplyFlow } from "@/components/apply/ApplyFlow";
import { currentUserId } from "@/lib/current-user";
import { prismaBase } from "@/lib/prisma-base";
import { gateRedirect } from "@/lib/gate-redirect";

export const metadata: Metadata = {
  title: "Apply for early access — consl",
  description:
    "consl is opening early access to twenty brands that make and sell physical products: lifetime 50% off and a personal brand manager who sets the platform up with you, 1-1.",
};

// The Calendly link is read per request so it can be set or changed without a redeploy.
export const dynamic = "force-dynamic";

export default async function ApplyPage() {
  // Someone signed in who already has a company has no business applying again: send them to
  // whatever stage they're at (the middleware decides — waiting screen, wizard or the app). A
  // signed-in visitor with NO company yet keeps the form: the account step links it for them.
  const userId = await currentUserId();
  if (userId) {
    const companies = await prismaBase.membership.count({ where: { clerkUserId: userId, organization: { deactivatedAt: null } } });
    if (companies > 0) return gateRedirect("/");
  }
  return <ApplyFlow calendlyUrl={process.env.CALENDLY_URL?.trim() || null} />;
}
