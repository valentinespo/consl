"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";

type Box = { top: number; left: number; below: boolean };

/**
 * A small "what does this mean?" icon with an explanation that fades in on hover.
 *
 * The bubble is portalled to the body and positioned in viewport coordinates rather than sitting
 * inside its parent: these live in rows whose container has `overflow-hidden` (it clips the card's
 * rounded corners), which would otherwise chop the bubble off. It's only in the DOM while open —
 * a page can hold a dozen of these and leaving a hidden copy of each around is waste.
 *
 * The fade is a CSS animation that plays on mount (`.hint-in`), not a state flip: a two-step
 * "mount hidden, then show" needs the second update to land in a later frame, and it doesn't
 * reliably — the bubble stayed at opacity 0 forever. Opens on keyboard focus too.
 */
export function HoverHint({
  title,
  body,
  size = 12,
  className = "",
}: {
  title?: string;
  body: string;
  size?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [mounted, setMounted] = useState(false);
  const [box, setBox] = useState<Box | null>(null);

  useEffect(() => setMounted(true), []);

  // Viewport coordinates go stale the moment the page moves, so follow the icon rather than
  // closing: tabbing to it scrolls it into view, and closing on scroll would slam the bubble
  // shut the instant a keyboard user reached it.
  const isOpen = box !== null;
  useEffect(() => {
    if (!isOpen) return;
    const follow = () => place();
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [isOpen]);

  /** Anchor the bubble to where the icon currently is on screen. */
  function place() {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = r.top < 170; // not enough room above — flip under the icon
    setBox({
      below,
      top: below ? r.bottom + 8 : r.top - 8,
      left: Math.min(Math.max(r.left + r.width / 2, 140), window.innerWidth - 140),
    });
  }

  return (
    <>
      <span
        ref={ref}
        tabIndex={0}
        role="button"
        aria-label={title ? `About ${title}` : "More information"}
        onMouseEnter={place}
        onMouseLeave={() => setBox(null)}
        onFocus={place}
        onBlur={() => setBox(null)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setBox(null);
        }}
        className={`inline-flex cursor-help items-center rounded-full opacity-70 outline-none transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent-strong ${className}`}
      >
        <Info size={size} />
      </span>

      {mounted &&
        box &&
        createPortal(
          <div
            role="tooltip"
            data-hover-hint
            style={{
              position: "fixed",
              top: box.top,
              left: box.left,
              transform: `translate(-50%, ${box.below ? "0" : "-100%"})`,
            }}
            className="hint-in pointer-events-none z-[200] w-[260px] rounded-xl border border-border bg-surface p-3 shadow-xl"
          >
            {title && <div className="mb-0.5 text-[12px] font-semibold text-ink">{title}</div>}
            <div className="text-[11.5px] leading-relaxed text-muted">{body}</div>
          </div>,
          document.body,
        )}
    </>
  );
}
