import { redirect } from "next/navigation";
import { currentUserId } from "@/lib/current-user";
import { getCurrentOrg } from "@/lib/org";
import { needsBillingGate } from "@/lib/billing";
import { gateRedirect } from "@/lib/gate-redirect";
import { prismaBase } from "@/lib/prisma-base";
import { PreOnboarding } from "@/components/apply/PreOnboarding";
import { calendlyConfigured, recordScheduledCall } from "@/lib/calendly";

export const dynamic = "force-dynamic";

/**
 * The waiting screen. A company created through the early-access flow lands here — from any
 * address it types — until its trial has started. Nothing to do but book the discovery call;
 * the "Start free trial" button is unlocked by an admin during that call.
 */
export default async function PreOnboardingPage() {
  const org = await getCurrentOrg();
  if (!org) redirect((await currentUserId()) ? "/welcome" : "/sign-in");
  if (!needsBillingGate(org)) return gateRedirect("/");

  const app = await prismaBase.accessApplication.findFirst({
    where: { orgId: org.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, fullName: true, email: true, callBookedAt: true, callScheduledAt: true, calendlyEventUri: true },
  });
  // A call booked before the Calendly token was configured has no appointment time yet: look it up now.
  let callScheduledAt = app?.callScheduledAt ?? null;
  if (app && !callScheduledAt && app.callBookedAt && app.calendlyEventUri && calendlyConfigured()) {
    callScheduledAt = (await recordScheduledCall(app.id, app.calendlyEventUri))?.startsAt ?? null;
  }

  return (
    <PreOnboarding
      orgName={org.name}
      firstName={app?.fullName.trim().split(/\s+/)[0] ?? null}
      email={app?.email ?? org.email ?? ""}
      applicationId={app?.id ?? null}
      callBookedAt={app?.callBookedAt?.toISOString() ?? null}
      callScheduledAt={callScheduledAt?.toISOString() ?? null}
      trialUnlocked={!!org.trialUnlockedAt}
      calendlyUrl={process.env.CALENDLY_URL?.trim() || null}
    />
  );
}
