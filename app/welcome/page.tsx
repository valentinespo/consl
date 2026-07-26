import { redirect } from "next/navigation";
import { currentUserId } from "@/lib/current-user";
import { getCurrentOrgId } from "@/lib/tenant";
import { WelcomeForm } from "@/components/WelcomeForm";

export const dynamic = "force-dynamic";

/**
 * Setting up a company. Reached automatically when you belong to none, or deliberately via
 * "Create new company" in the switcher — hence `?new=1`, which keeps the form available to
 * someone who already has one.
 */
export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  if (!(await currentUserId())) redirect("/sign-in");
  const { new: isAdditional } = await searchParams;
  // Only bounce people who landed here with nothing to do: they already have a company and
  // didn't ask to add another.
  if (!isAdditional && (await getCurrentOrgId())) redirect("/");
  return <WelcomeForm additional={isAdditional === "1"} />;
}
