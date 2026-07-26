import { redirect } from "next/navigation";
import Link from "next/link";
import { currentUserId } from "@/lib/current-user";
import { prismaBase } from "@/lib/prisma-base";
import { JoinButton } from "@/components/JoinButton";

export const dynamic = "force-dynamic";

/** Landing page for an invite link. The token is looked up unscoped — the visitor has no
 *  organization yet, which is exactly what the invite is for. */
export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!(await currentUserId())) redirect(`/sign-in?redirect_url=/join/${encodeURIComponent(token)}`);

  const invite = await prismaBase.invite.findUnique({
    where: { token },
    include: { organization: { select: { name: true } } },
  });

  const problem = !invite || !invite.organization
    ? "This invite link isn't valid."
    : invite.acceptedAt
      ? "This invite has already been used."
      : invite.expiresAt < new Date()
        ? "This invite has expired. Ask whoever sent it for a new one."
        : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-2 p-6">
      <div className="w-full max-w-[420px] rounded-[var(--radius-card)] border border-border bg-surface p-7 text-center shadow-sm">
        {problem ? (
          <>
            <h1 className="text-[19px] font-semibold text-ink">Can&apos;t use this invite</h1>
            <p className="mt-2 text-[13.5px] text-muted">{problem}</p>
            <Link
              href="/"
              className="mt-5 inline-block rounded-lg border border-border px-3.5 py-2 text-[13px] text-ink-soft hover:bg-surface-2"
            >
              Go to the app
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-[19px] font-semibold text-ink">Join {invite!.organization!.name}</h1>
            <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
              You&apos;ve been invited as {invite!.role === "owner" ? "an owner" : "a member"}. Joining gives
              you access to this company&apos;s products, inventory and production.
            </p>
            <JoinButton token={token} orgName={invite!.organization!.name} />
          </>
        )}
      </div>
    </div>
  );
}
