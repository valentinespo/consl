"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, X, ArrowRight } from "@/components/icons";
import { dismissNotification } from "@/app/settings/actions";

export type SetupStep = { label: string; body: string; href: string; cta: string; done: boolean };

/** First-run guide. Shows the remaining setup in order, so a company starting with zero data
 *  always has an obvious next action. Disappears on its own once everything is done. */
export function GettingStarted({ steps, dismissKey }: { steps: SetupStep[]; dismissKey: string }) {
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  const [, start] = useTransition();

  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);
  if (hidden || !next) return null;

  function dismiss() {
    setHidden(true);
    start(async () => {
      await dismissNotification(dismissKey);
      router.refresh();
    });
  }

  return (
    <div className="mb-6 rounded-[var(--radius-card)] border border-accent-strong bg-accent-soft p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[14px] font-semibold text-ink">Getting started</div>
          <div className="mt-0.5 text-[12.5px] text-muted">
            {done} of {steps.length} done — next up: {next.label.toLowerCase()}.
          </div>
        </div>
        <button onClick={dismiss} title="Hide this" className="shrink-0 rounded-md p-1 text-muted hover:bg-black/5 hover:text-ink-soft">
          <X size={16} />
        </button>
      </div>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface">
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>

      <ol className="mt-4 space-y-1.5">
        {steps.map((s) => (
          <li key={s.label}>
            {s.done ? (
              <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] text-muted">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-positive text-white">
                  <Check size={12} strokeWidth={3} />
                </span>
                <span className="line-through decoration-muted/50">{s.label}</span>
              </div>
            ) : (
              <Link
                href={s.href}
                className="group flex items-center gap-2.5 rounded-lg border border-transparent px-2 py-1.5 text-[13px] transition-colors hover:border-border hover:bg-surface"
              >
                <span className="h-5 w-5 shrink-0 rounded-full border-2 border-border" />
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-ink">{s.label}</span>
                  <span className="ml-1.5 text-muted">{s.body}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1 text-[12px] font-medium text-accent opacity-0 transition-opacity group-hover:opacity-100">
                  {s.cta} <ArrowRight size={12} />
                </span>
              </Link>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
