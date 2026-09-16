import { gateRedirect } from "@/lib/gate-redirect";
import { SignUp } from "@clerk/nextjs";
import { currentUserId } from "@/lib/current-user";
import { safeReturnPath } from "@/lib/return-path";

export const dynamic = "force-dynamic";

/** Same rule as the sign-in page: someone already signed in goes into the app on the server. */
export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ redirect_url?: string }> }) {
  if (await currentUserId()) {
    const { redirect_url } = await searchParams;
    return gateRedirect(safeReturnPath(redirect_url) ?? "/");
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-2 p-6">
      <SignUp />
    </div>
  );
}
