import { redirect } from "next/navigation";
import { currentUserId } from "@/lib/current-user";
import { getCurrentOrgId } from "@/lib/tenant";
import { WelcomeForm } from "@/components/WelcomeForm";

export const dynamic = "force-dynamic";

/** Where a signed-in user lands when they don't belong to a company yet. */
export default async function WelcomePage() {
  if (!(await currentUserId())) redirect("/sign-in");
  // Already in a company (including anyone arriving here by typing the URL) — nothing to set up.
  if (await getCurrentOrgId()) redirect("/");
  return <WelcomeForm />;
}
