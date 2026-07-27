"use client";

import { useState } from "react";
import { acceptInvite } from "@/app/team/actions";

export function JoinButton({ token, orgName }: { token: string; orgName: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    setError(null);
    setPending(true);
    const res = await acceptInvite(token);
    if (!res.ok) {
      setError(res.error);
      setPending(false);
      return;
    }
    // Full reload so every server component picks up the new company.
    window.location.href = "/";
  }

  return (
    <>
      {error && <div className="mt-4 rounded-lg bg-[#fdf2ef] px-3 py-2 text-[12.5px] text-negative">{error}</div>}
      <button
        onClick={join}
        disabled={pending}
        className="mt-5 h-10 w-full rounded-lg bg-ink text-[14px] font-medium text-bg hover:opacity-90 disabled:opacity-40"
      >
        {pending ? "Joining…" : `Join ${orgName}`}
      </button>
    </>
  );
}
