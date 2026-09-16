import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentOrgId } from "@/lib/tenant";
import { currentUserId } from "@/lib/current-user";
import { getCurrentOrg } from "@/lib/org";
import { needsBillingGate } from "@/lib/billing";
import { isOpenPath } from "@/lib/gates";

/**
 * The gates. They live in a TEMPLATE, not the root layout, on purpose: Next.js re-renders a
 * template on every navigation, while the root layout is rendered once per full page load and is
 * skipped on client-side navigations. With the gates in the layout, a gated company could reach
 * the dashboard by any in-app hop — the sign-in page forwarding an already-signed-in visitor to
 * "/", a link, the back button — and only a refresh would send it back. That is exactly what
 * happened on 2026-09-16 with the founder's test company.
 *
 * Order matters:
 *  1. Signed in but no company yet → set one up.
 *  2. Company whose trial hasn't started (early access) → the waiting screen, from any address.
 *  3. Company that hasn't finished the setup wizard → the wizard.
 * The open paths (auth, marketing, the application flow, the waiting screen itself) are exempt.
 */
export default async function RootTemplate({ children }: { children: React.ReactNode }) {
  const pathname = (await headers()).get("x-pathname") ?? "";
  if (!isOpenPath(pathname)) {
    const orgId = await getCurrentOrgId();
    if (!orgId) {
      if (await currentUserId()) redirect("/welcome");
    } else {
      const org = await getCurrentOrg().catch(() => null);
      if (org && needsBillingGate(org)) redirect("/pre-onboarding");
      if (org && !org.onboardedAt && !pathname.startsWith("/onboarding")) redirect("/onboarding");
    }
  }
  return <>{children}</>;
}
