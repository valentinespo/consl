"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowOutbound, Lock } from "@/components/icons";
import { openCompany, setTrialUnlocked } from "@/app/internal/actions";

const GHOST =
  "inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-[12.5px] font-medium text-ink-soft transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60";
const SOLID =
  "inline-flex h-8 items-center gap-1.5 rounded-lg bg-ink px-3 text-[12.5px] font-medium text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60";

/** Unlock (or re-lock) a company's "Start 14-day free trial" button. */
export function TrialToggle({ orgId, unlocked }: { orgId: string; unlocked: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function toggle() {
    setPending(true);
    setError(null);
    try {
      const r = await setTrialUnlocked(orgId, !unlocked);
      if (!r.ok) setError(r.error);
      else router.refresh();
    } catch {
      setError("Something went wrong.");
    } finally {
      setPending(false);
    }
  }
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button type="button" onClick={toggle} disabled={pending} className={unlocked ? GHOST : SOLID}>
        {!unlocked && <Lock size={13} />}
        {pending ? "One moment…" : unlocked ? "Lock trial again" : "Unlock trial"}
      </button>
      {error && <span className="text-[11px] text-negative">{error}</span>}
    </span>
  );
}

/** Open the company in the app, as its owner would see it. */
export function OpenCompanyButton({ orgId, label = "Open company" }: { orgId: string; label?: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function open() {
    setPending(true);
    setError(null);
    try {
      const r = await openCompany(orgId);
      if (!r.ok) setError(r.error);
      // Full reload: every server component on the page belongs to the previous company.
      else window.location.href = "/";
    } catch {
      setError("Something went wrong.");
    } finally {
      setPending(false);
    }
  }
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button type="button" onClick={open} disabled={pending} className={GHOST}>
        {pending ? "Opening…" : label}
        <ArrowOutbound size={13} />
      </button>
      {error && <span className="text-[11px] text-negative">{error}</span>}
    </span>
  );
}
