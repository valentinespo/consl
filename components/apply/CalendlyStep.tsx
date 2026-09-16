"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, ExternalLink } from "@/components/icons";
import { Em, Heading, Notice, PRIMARY } from "@/components/apply/fields";
import { markCallBooked } from "@/app/apply/actions";

/**
 * Calendly, inline. The scheduling page is Calendly's own iframe; it tells the parent window
 * what happened through postMessage, and "event_scheduled" is the moment we record the booking
 * and move the person on. The URL comes from the CALENDLY_URL env var so it can change without
 * a deploy; when it's missing (a preview box) the step says so instead of showing a blank.
 */

declare global {
  interface Window {
    Calendly?: {
      initInlineWidget: (o: { url: string; parentElement: HTMLElement; prefill?: Record<string, string>; resize?: boolean }) => void;
    };
  }
}

const SCRIPT = "https://assets.calendly.com/assets/external/widget.js";

export type Scheduled = { eventUri?: string; inviteeUri?: string };

/** Colours the embed to match the page and hides the cookie banner inside the iframe. */
function styledUrl(url: string): string {
  const u = new URL(url);
  u.searchParams.set("hide_gdpr_banner", "1");
  u.searchParams.set("primary_color", "7c3aed");
  u.searchParams.set("text_color", "171717");
  u.searchParams.set("background_color", "ffffff");
  return u.toString();
}

export function CalendlyEmbed({
  url,
  name,
  email,
  onScheduled,
  minHeight = 720,
}: {
  url: string;
  name: string;
  email: string;
  onScheduled: (s: Scheduled) => void;
  minHeight?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const cb = useRef(onScheduled);
  const [failed, setFailed] = useState(false);
  // Keep the latest callback without re-initialising the widget on every parent render.
  useEffect(() => {
    cb.current = onScheduled;
  });

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let cancelled = false;
    // The floor gives Calendly's page room to lay itself out before it has measured anything; once
    // it reports a real height the frame follows that exactly (measured: the calendar view asks for
    // ~660px, so a fixed floor would leave a blank band under it).
    const setFloor = (px: number) => {
      el.style.minHeight = `${px}px`;
      el.querySelectorAll("iframe").forEach((f) => (f.style.minHeight = `${px}px`));
    };
    const init = () => {
      if (cancelled || !window.Calendly) return;
      el.innerHTML = "";
      // resize: Calendly sizes its own frame to the scheduling page, so nothing scrolls inside a box.
      window.Calendly.initInlineWidget({ url: styledUrl(url), parentElement: el, prefill: { name, email }, resize: true });
      setFloor(minHeight);
      setTimeout(() => setFloor(minHeight), 500);
    };
    if (window.Calendly) init();
    else {
      let s = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT}"]`);
      if (!s) {
        s = document.createElement("script");
        s.src = SCRIPT;
        s.async = true;
        document.head.appendChild(s);
      }
      s.addEventListener("load", init, { once: true });
      s.addEventListener("error", () => setFailed(true), { once: true });
    }
    const onMessage = (e: MessageEvent) => {
      if (!/^https:\/\/([a-z0-9-]+\.)*calendly\.com$/.test(e.origin)) return;
      const d = e.data as { event?: string; payload?: { height?: string; event?: { uri?: string }; invitee?: { uri?: string } } } | null;
      // Calendly's first size messages are its loading states (a few px); the first real one means
      // the page is laid out and the floor can go.
      if (d?.event === "calendly.page_height" && parseFloat(d.payload?.height ?? "0") > 300) setFloor(0);
      if (d?.event === "calendly.event_scheduled") cb.current({ eventUri: d.payload?.event?.uri, inviteeUri: d.payload?.invitee?.uri });
    };
    window.addEventListener("message", onMessage);
    return () => {
      cancelled = true;
      window.removeEventListener("message", onMessage);
    };
  }, [url, name, email, minHeight]);

  // Calendly's page carries its own margins around the booking card — none in its phone layout
  // (frames under ~650px), 66px above and 30px below in both desktop layouts (measured 2026-09-16
  // in every view). Those are trimmed off here so the card sits close to what surrounds it instead
  // of floating in a blank band; the query keys off the frame's own width, so a narrow frame that
  // gets Calendly's phone layout keeps a little breathing room and nothing gets cut.
  return (
    <div>
      <div className="@container">
        <div className="overflow-hidden py-4 @[720px]:py-0">
          <div ref={box} className="w-full @[720px]:-mt-[38px] @[720px]:-mb-[10px]" />
        </div>
      </div>
      {failed && (
        <Notice>
          The calendar didn&apos;t load.{" "}
          <a href={url} target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-2">
            Open it in a new tab
          </a>
          .
        </Notice>
      )}
    </div>
  );
}

export function CalendlyStep({
  url,
  name,
  email,
  applicationId,
  onBooked,
}: {
  url: string | null;
  name: string;
  email: string;
  applicationId: string;
  onBooked: () => void;
}) {
  const [booked, setBooked] = useState(false);

  async function scheduled(s: Scheduled) {
    setBooked(true);
    await markCallBooked(applicationId, s.eventUri, s.inviteeUri).catch(() => {});
    // Let the confirmation register for a beat before the page changes under them.
    setTimeout(onBooked, 1400);
  }

  return (
    <div>
      <Heading
        title={
          <>
            Book your <Em>demo</Em>.
          </>
        }
        sub="Pick a time that suits you. Your brand manager will walk you through consl on your own numbers and start your 14-day free trial with you on the demo."
      />
      {booked ? (
        <div className="step-in mt-8 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-[15px] font-medium text-emerald-800">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-600 text-white">
            <Check size={14} />
          </span>
          Booked. Taking you to your workspace…
        </div>
      ) : url ? (
        <div className="mt-6 border-t border-neutral-200">
          <CalendlyEmbed url={url} name={name} email={email} onScheduled={scheduled} />
        </div>
      ) : (
        <div className="mt-8 space-y-5">
          <Notice>Booking isn&apos;t connected on this environment yet, so this step is skipped here.</Notice>
          <button type="button" onClick={onBooked} className={PRIMARY}>
            Continue to your workspace
            <ArrowRight size={16} />
          </button>
        </div>
      )}
      {url && !booked && (
        <p className="mt-4 text-[12.5px] text-neutral-500">
          Calendar not loading?{" "}
          <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-neutral-700 hover:text-neutral-900">
            Open it in a new tab <ExternalLink size={12} />
          </a>
        </p>
      )}
    </div>
  );
}
