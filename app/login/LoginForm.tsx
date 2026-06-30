"use client";

import { useActionState } from "react";
import { login } from "./actions";

export function LoginForm({ from }: { from: string }) {
  const [state, action, pending] = useActionState(login, null);
  return (
    <form action={action} className="w-full max-w-[340px] rounded-[var(--radius-card)] border border-border bg-surface p-7 shadow-sm">
      <div className="mb-5 flex items-center gap-2">
        <span className="text-[22px] font-semibold tracking-tight text-ink">herbl</span>
        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-soft">Ops</span>
      </div>
      <h1 className="text-[15px] font-semibold text-ink-soft">Sign in</h1>
      <p className="mb-4 mt-0.5 text-[12.5px] text-muted">Enter the team password to continue.</p>

      <input type="hidden" name="from" value={from} />
      <label className="block">
        <span className="mb-1 block text-[12px] font-medium text-muted">Password</span>
        <input
          name="password"
          type="password"
          autoFocus
          autoComplete="current-password"
          className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-[14px] text-ink outline-none focus:border-accent-strong"
        />
      </label>

      {state?.error && <p className="mt-2 text-[12.5px] text-negative">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="mt-4 h-10 w-full rounded-lg bg-ink text-[13.5px] font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
