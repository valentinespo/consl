import { gateRedirect } from "@/lib/gate-redirect";
import { SignIn } from "@clerk/nextjs";
import { currentUserId } from "@/lib/current-user";
import { safeReturnPath } from "@/lib/return-path";

export const dynamic = "force-dynamic";

/**
 * A signed-in visitor has no business here: send them into the app on the server, where the
 * product gate decides where they actually belong. Leaving it to Clerk's component to forward
 * them client-side crossed the app boundary mid-transition and crashed the shell (2026-09-16).
 */
export default async function SignInPage({ searchParams }: { searchParams: Promise<{ redirect_url?: string }> }) {
  if (await currentUserId()) {
    const { redirect_url } = await searchParams;
    return gateRedirect(safeReturnPath(redirect_url) ?? "/");
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-2 p-6">
      <SignIn />
    </div>
  );
}
