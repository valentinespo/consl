import { gateRedirect } from "@/lib/gate-redirect";
import { getCurrentOrgId } from "@/lib/tenant";
import { currentUserId } from "@/lib/current-user";
import { getCurrentOrg } from "@/lib/org";
import { needsBillingGate } from "@/lib/billing";

/**
 * The gate in front of the product. Every product page lives in this route group; the auth
 * screens, marketing pages, application flow, setup wizard and waiting screen live outside it.
 *
 * Next.js renders a layout when navigation ENTERS its segment — so crossing from any open page
 * into the app (a link, the sign-in page forwarding an already-signed-in visitor to "/", the back
 * button) runs these checks on the server, as does every full page load. A root layout or root
 * template cannot do this: the root segment is shared by every route and is skipped on
 * client-side navigation, which is how a gated company reached the dashboard on 2026-09-16.
 *
 * Order: no company yet → set one up; trial not started (early access) → the waiting screen;
 * setup wizard unfinished → the wizard. /onboarding sits outside the group and repeats the
 * billing check itself. Redirects go through gateRedirect — see lib/gate-redirect.tsx for why.
 */
export default async function AppGateLayout({ children }: { children: React.ReactNode }) {
  const orgId = await getCurrentOrgId();
  if (!orgId) {
    // Signed in with no company: set one up. Signed out never gets here (middleware).
    if (await currentUserId()) return gateRedirect("/welcome");
    return <>{children}</>;
  }
  const org = await getCurrentOrg().catch(() => null);
  if (org && needsBillingGate(org)) return gateRedirect("/pre-onboarding");
  if (org && !org.onboardedAt) return gateRedirect("/onboarding");
  return <>{children}</>;
}
