"use client";

import { useState, type ReactNode } from "react";
import { SignOutButton } from "@clerk/nextjs";
import { CalendarDays, Check, Lock } from "@/components/icons";
import { CalendlyEmbed, type Scheduled } from "@/components/apply/CalendlyStep";
import { markCallBooked } from "@/app/apply/actions";
import { startTrial } from "@/app/pre-onboarding/actions";

/**
 * The pre-onboarding waiting screen, in the app's own theme (it's an app page, not marketing).
 * Before the call is booked the calendar is simply open on the page; afterwards the page says
 * there's nothing to do, shows the booked call, and the trial button waits, greyed, for an admin
 * to unlock it on the call.
 */
export function PreOnboarding({
  orgName,
  firstName,
  email,
  applicationId,
  callBookedAt,
  callScheduledAt,
  trialUnlocked,
  calendlyUrl,
}: {
  orgName: string;
  firstName: string | null;
  email: string;
  applicationId: string | null;
  callBookedAt: string | null;
  /** The appointment itself (ISO), when Calendly's API told us; null = only the booking moment is known. */
  callScheduledAt: string | null;
  trialUnlocked: boolean;
  calendlyUrl: string | null;
}) {
  const [booked, setBooked] = useState<string | null>(callBookedAt);
  const [scheduledAt, setScheduledAt] = useState<string | null>(callScheduledAt);
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function scheduled(s: Scheduled) {
    setBooked(new Date().toISOString());
    if (!applicationId) return;
    const res = await markCallBooked(applicationId, s.eventUri, s.inviteeUri).catch(() => null);
    if (res?.ok && res.scheduledAt) setScheduledAt(res.scheduledAt);
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

  // Formatted in the viewer's own timezone — it's their calendar, not ours.
  const bookedLabel = booked ? new Date(booked).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : null;
  const callLabel = scheduledAt
    ? new Date(scheduledAt).toLocaleString(undefined, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })
    : null;
  const callBody = callLabel
    ? `${callLabel}, your local time. The invite is in your inbox.`
    : `Booked ${bookedLabel}. The invite with the exact time is in your inbox.`;

  // Wide while the calendar is on the page — Calendly lays the month and the time slots side by
  // side only from about 1000px — and back to a compact card once the call is booked.
  return (
    <div className="min-h-screen bg-surface-2 px-5 py-8 sm:py-12">
      <div className={`mx-auto w-full transition-[max-width] ${booked ? "max-w-[600px]" : "max-w-[1040px]"}`}>
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
            {booked ? "Nothing to do here until your discovery call" : "Book your discovery call"}
            {firstName ? `, ${firstName}` : ""}.
          </h1>
          <p className="mt-3 text-[14.5px] leading-relaxed text-muted">
            {booked
              ? "If you're a good fit, your brand manager will help you set up your 14-day free trial and onboard you to the platform in that same call. Yes, as easy as that."
              : "Pick a time below. On the call, your brand manager will help you set up your 14-day free trial and onboard you to the platform. Yes, as easy as that."}
          </p>

          {/* The calendar stays open until the call is booked — no button to find, nothing to hide. */}
          {!booked &&
            (calendlyUrl ? (
              <div className="mt-6 overflow-hidden rounded-xl border border-border bg-white">
                <CalendlyEmbed url={calendlyUrl} name={firstName ?? ""} email={email} onScheduled={scheduled} minHeight={720} />
              </div>
            ) : (
              <div className="mt-6 rounded-xl border border-border bg-bg px-4 py-3.5 text-[13.5px] text-muted">
                Booking opens shortly. We&apos;ll email you the link.
              </div>
            ))}

          <div className="mt-6 space-y-2.5">
            {booked && (
              <Row
                icon={<CalendarDays size={17} />}
                done
                title={callLabel ? "Your discovery call" : "Discovery call booked"}
                body={callBody}
              />
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
