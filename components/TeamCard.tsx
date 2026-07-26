"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Copy, Check, X } from "lucide-react";
import { Card } from "@/components/ui";
import { createInvite, revokeInvite, removeMember } from "@/app/team/actions";

export type TeamMember = { clerkUserId: string; role: string; createdAt: string; isYou: boolean };
export type PendingInvite = { id: string; email: string; role: string; token: string; expiresAt: string };

const inputCls =
  "h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-accent-strong";

export function TeamCard({
  members,
  invites,
  isOwner,
}: {
  members: TeamMember[];
  invites: PendingInvite[];
  isOwner: boolean;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"owner" | "member">("member");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const linkFor = (token: string) =>
    typeof window === "undefined" ? `/join/${token}` : `${window.location.origin}/join/${token}`;

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(linkFor(token));
      setCopied(token);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      setError("Couldn't copy — select the link and copy it manually.");
    }
  }

  async function invite() {
    setError(null);
    setPending(true);
    const res = await createInvite({ email, role });
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setEmail("");
    await copy(res.token);
    router.refresh();
  }

  return (
    <Card className="mt-4">
      <div className="mb-4 text-[12px] font-medium uppercase tracking-wide text-muted">Team</div>

      <div className="space-y-2">
        {members.map((m) => (
          <div key={m.clerkUserId} className="flex items-center gap-3 rounded-xl border border-border bg-surface-2/40 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-ink">
                {m.isYou ? "You" : m.clerkUserId}
              </div>
              <div className="text-[11.5px] text-muted">Joined {m.createdAt}</div>
            </div>
            <span className="rounded-md border border-border bg-surface px-1.5 py-0.5 text-[10.5px] font-medium text-muted">
              {m.role === "owner" ? "Owner" : "Member"}
            </span>
            {isOwner && !m.isYou && (
              <button
                onClick={async () => {
                  const res = await removeMember(m.clerkUserId);
                  if (!res.ok) setError(res.error);
                  else router.refresh();
                }}
                className="rounded-lg p-1 text-muted hover:bg-surface-2 hover:text-negative"
                aria-label="Remove from company"
              >
                <X size={15} />
              </button>
            )}
          </div>
        ))}
      </div>

      {invites.length > 0 && (
        <>
          <div className="mb-2 mt-5 text-[12px] font-medium uppercase tracking-wide text-muted">Pending invites</div>
          <div className="space-y-2">
            {invites.map((iv) => (
              <div key={iv.id} className="flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-ink-soft">{iv.email}</div>
                  <div className="text-[11.5px] text-muted">
                    {iv.role === "owner" ? "Owner" : "Member"} · expires {iv.expiresAt}
                  </div>
                </div>
                <button
                  onClick={() => copy(iv.token)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[12px] text-ink-soft hover:bg-surface-2"
                >
                  {copied === iv.token ? <Check size={13} /> : <Copy size={13} />}
                  {copied === iv.token ? "Copied" : "Copy link"}
                </button>
                {isOwner && (
                  <button
                    onClick={async () => {
                      const res = await revokeInvite(iv.id);
                      if (!res.ok) setError(res.error);
                      else router.refresh();
                    }}
                    className="rounded-lg p-1 text-muted hover:bg-surface-2 hover:text-negative"
                    aria-label="Withdraw invite"
                  >
                    <X size={15} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {isOwner && (
        <div className="mt-5 border-t border-line pt-4">
          <div className="mb-2 text-[12.5px] font-medium text-ink-soft">Invite someone</div>
          <p className="mb-3 text-[11.5px] text-muted">
            Creates a private link you send them yourself. They&apos;ll need to sign in (or sign up)
            before it works. Links last 14 days.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[180px] flex-1">
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && email.trim() && !pending) invite();
                }}
                placeholder="their@email.com"
                className={inputCls}
              />
            </div>
            <select value={role} onChange={(e) => setRole(e.target.value as "owner" | "member")} className={`${inputCls} w-[120px]`}>
              <option value="member">Member</option>
              <option value="owner">Owner</option>
            </select>
            <button
              onClick={invite}
              disabled={pending || !email.trim()}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-3 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-40"
            >
              <UserPlus size={15} />
              {pending ? "Creating…" : "Create link"}
            </button>
          </div>
        </div>
      )}

      {error && <div className="mt-3 text-[12px] text-negative">{error}</div>}
    </Card>
  );
}
