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
    const init = () => {
      if (cancelled || !window.Calendly) return;
      el.innerHTML = "";
      // resize: Calendly grows its own frame to fit the scheduling page, so nothing scrolls inside
      // a box — the box takes the page's full height in either of Calendly's layouts. The floor
      // below is only for the moment before the first size message (and if it never comes).
      window.Calendly.initInlineWidget({ url: styledUrl(url), parentElement: el, prefill: { name, email }, resize: true });
      const floor = () => el.querySelectorAll("iframe").forEach((f) => (f.style.minHeight = `${minHeight}px`));
      floor();
      setTimeout(floor, 500);
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
      const d = e.data as { event?: string; payload?: { event?: { uri?: string }; invitee?: { uri?: string } } } | null;
      if (d?.event === "calendly.event_scheduled") cb.current({ eventUri: d.payload?.event?.uri, inviteeUri: d.payload?.invitee?.uri });
    };
    window.addEventListener("message", onMessage);
    return () => {
      cancelled = true;
      window.removeEventListener("message", onMessage);
    };
  }, [url, name, email, minHeight]);

  return (
    <div>
      {/* Height comes from Calendly's own resize messages (see init); the floor keeps the box from
          collapsing to the browser's 150px default before the first one arrives. */}
      <div ref={box} style={{ minHeight }} className="w-full" />
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
            Book your <Em>discovery call</Em>.
          </>
        }
        sub="Pick a time that suits you. Your brand manager will walk you through the setup and start your 14-day free trial with you on the call."
      />
      {booked ? (
        <div className="step-in mt-8 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-[15px] font-medium text-emerald-800">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-600 text-white">
            <Check size={14} />
          </span>
          Booked. Taking you to your workspace…
        </div>
      ) : url ? (
        <div className="mt-6 overflow-hidden rounded-2xl border border-neutral-200">
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
