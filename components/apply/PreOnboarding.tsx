"use client";

import { useState, type ReactNode } from "react";
import { SignOutButton } from "@clerk/nextjs";
import { CalendarDays, Check, Lock } from "@/components/icons";
import { CalendlyEmbed, type Scheduled } from "@/components/apply/CalendlyStep";
import { markCallBooked } from "@/app/apply/actions";
import { startTrial } from "@/app/pre-onboarding/actions";

/**
 * The pre-onboarding waiting screen, in the app's own theme (it's an app page, not marketing).
 * Two things on it: the discovery call (booked, or book it now) and the trial button, greyed
 * until an admin unlocks it on the call.
 */
export function PreOnboarding({
  orgName,
  firstName,
  email,
  applicationId,
  callBookedAt,
  trialUnlocked,
  calendlyUrl,
}: {
  orgName: string;
  firstName: string | null;
  email: string;
  applicationId: string | null;
  callBookedAt: string | null;
  trialUnlocked: boolean;
  calendlyUrl: string | null;
}) {
  const [booked, setBooked] = useState<string | null>(callBookedAt);
  const [showCalendar, setShowCalendar] = useState(false);
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function scheduled(s: Scheduled) {
    setBooked(new Date().toISOString());
    setShowCalendar(false);
    if (applicationId) await markCallBooked(applicationId, s.eventUri, s.inviteeUri).catch(() => {});
  }

  async function onStartTrial() {
    setPending(true);
    setNote(null);
    try {
      const r = await startTrial();
      if (r.ok) window.location.href = r.url;
      else setNote(r.error);
    } catch {
      setNote("Something went wrong. Try again in a moment.");
    } finally {
      setPending(false);
    }
  }

  const bookedLabel = booked
    ? new Date(booked).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : null;

  return (
    <div className="min-h-screen bg-surface-2 px-5 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-[600px]">
        <div className="mb-6 flex items-center justify-between">
          <span className="inline-flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/consl-mark.png" alt="" className="iso-invert h-6 w-6 object-contain" />
            <span className="text-[17px] font-bold tracking-tight text-ink">consl</span>
          </span>
          <div className="flex items-center gap-3 text-[13px]">
            <span className="max-w-[200px] truncate text-muted">{orgName}</span>
            <SignOutButton redirectUrl="/home">
              <button className="rounded-lg border border-border bg-surface px-3 py-1.5 font-medium text-ink-soft hover:bg-surface-2">Sign out</button>
            </SignOutButton>
          </div>
        </div>

        <div className="rounded-[var(--radius-card)] border border-border bg-surface p-7 shadow-sm sm:p-8">
          <span className="pill-chart inline-flex items-center rounded-full px-3 py-1 text-[12px] font-semibold">Early access</span>
          <h1 className="mt-4 text-[24px] font-semibold leading-tight tracking-tight text-ink sm:text-[27px]">
            Nothing to do here until your discovery call{firstName ? `, ${firstName}` : ""}.
          </h1>
          <p className="mt-3 text-[14.5px] leading-relaxed text-muted">
            If you&apos;re a good fit, your brand manager will help you set up your 14-day free trial and onboard you to
            the platform in that same call. Yes, as easy as that.
          </p>

          <div className="mt-7 space-y-2.5">
            <Row
              icon={<CalendarDays size={17} />}
              done={!!booked}
              title={booked ? "Discovery call booked" : "Book your discovery call"}
              body={booked ? `Booked ${bookedLabel}. The invite is in your inbox.` : "Pick a time that suits you."}
              action={
                !booked && calendlyUrl ? (
                  <button
                    type="button"
                    onClick={() => setShowCalendar((s) => !s)}
                    className="rounded-lg bg-ink px-3 py-1.5 text-[12.5px] font-medium text-bg hover:opacity-90"
                  >
                    {showCalendar ? "Hide calendar" : "Pick a time"}
                  </button>
                ) : null
              }
            />
            {showCalendar && !booked && calendlyUrl && (
              <div className="dropdown-in overflow-hidden rounded-xl border border-border bg-white">
                <CalendlyEmbed url={calendlyUrl} name={firstName ?? ""} email={email} onScheduled={scheduled} minHeight={660} />
              </div>
            )}
            <Row
              icon={<Lock size={16} />}
              done={false}
              title="Start your 14-day free trial"
              body={trialUnlocked ? "Your brand manager unlocked this for you." : "Your brand manager activates this during your call."}
            />
          </div>

          <button
            type="button"
            onClick={onStartTrial}
            disabled={!trialUnlocked || pending}
            className="mt-6 h-11 w-full rounded-lg bg-ink text-[14px] font-medium text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-35"
          >
            {pending ? "One moment…" : "Start 14-day free trial"}
          </button>
          {note && <p className="mt-2.5 text-center text-[12.5px] text-muted">{note}</p>}

          <p className="mt-6 text-[12.5px] leading-relaxed text-muted">
            Save this page, or just come back to consl.ai and log in whenever. You&apos;ll land right here until your trial
            starts.
          </p>
        </div>
      </div>
    </div>
  );
}

function Row({ icon, done, title, body, action }: { icon: ReactNode; done: boolean; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex items-center gap-3.5 rounded-xl border border-border bg-bg px-4 py-3.5">
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
          done ? "bg-positive/10 text-positive" : "bg-surface-2 text-muted"
        }`}
      >
        {done ? <Check size={16} /> : icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-medium text-ink">{title}</div>
        <div className="text-[12.5px] text-muted">{body}</div>
      </div>
      {action}
    </div>
  );
}
