"use client";

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info } from "@/components/icons";

type Box = { top: number; left: number; below: boolean };

// One bubble at a time, page-wide. On a phone a finger sweeping down a column "enters" every
// row's trigger and never "leaves" it (touch fires no mouseleave), so without this every hint the
// finger crossed stayed open — a stack of a dozen bubbles over the Orders table.
let openHint: { token: object; close: () => void } | null = null;

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
 * reliably — the bubble stayed at opacity 0 forever.
 *
 * Mouse: open while hovering. Touch: a tap opens, a second tap (or a tap anywhere else, or a
 * scroll) closes. Keyboard: open while focused.
 */
export function HoverHint({
  title,
  body,
  size = 12,
  className = "",
  children,
}: {
  title?: string;
  body: ReactNode;
  size?: number;
  className?: string;
  /** Use this element as the trigger instead of the (i) icon — for hinting a label in place. */
  children?: ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const token = useRef({});
  const byTouch = useRef(false);
  // A focus that lands right after a press is the tap itself, not the keyboard reaching the icon.
  const pressed = useRef(false);
  const [mounted, setMounted] = useState(false);
  const [box, setBox] = useState<Box | null>(null);

  useEffect(() => setMounted(true), []);

  const close = useCallback(() => {
    setBox(null);
    if (openHint?.token === token.current) openHint = null;
  }, []);

  /** Anchor the bubble to where the icon currently is on screen, closing any other open hint. */
  const place = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (openHint && openHint.token !== token.current) openHint.close();
    openHint = { token: token.current, close };
    const r = el.getBoundingClientRect();
    const below = r.top < 170; // not enough room above — flip under the icon
    setBox({
      below,
      top: below ? r.bottom + 8 : r.top - 8,
      left: Math.min(Math.max(r.left + r.width / 2, 140), window.innerWidth - 140),
    });
  }, [close]);

  // Viewport coordinates go stale the moment the page moves. For the mouse and keyboard, follow
  // the icon (tabbing to it scrolls it into view — closing then would slam the bubble shut the
  // instant a keyboard user reached it); for a finger, a scroll means "done reading".
  const isOpen = box !== null;
  useEffect(() => {
    if (!isOpen) return;
    const onMove = () => (byTouch.current ? close() : place());
    const onPress = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    document.addEventListener("pointerdown", onPress);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
      document.removeEventListener("pointerdown", onPress);
    };
  }, [isOpen, close, place]);

  // Unmounting while open must free the page-wide slot (no state to touch — the bubble goes with it).
  useEffect(() => {
    const mine = token.current;
    return () => {
      if (openHint?.token === mine) openHint = null;
    };
  }, []);

  return (
    <>
      <span
        ref={ref}
        tabIndex={0}
        role="button"
        aria-label={title ? `About ${title}` : "More information"}
        onPointerEnter={(e) => {
          if (e.pointerType !== "mouse") return;
          byTouch.current = false;
          place();
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") close();
        }}
        onPointerDown={(e) => {
          pressed.current = true;
          setTimeout(() => (pressed.current = false), 400);
          if (e.pointerType === "mouse") return;
          byTouch.current = true;
          if (box) close();
          else place();
        }}
        onFocus={() => {
          if (pressed.current) return;
          byTouch.current = false;
          place();
        }}
        onBlur={close}
        // The icon is purely informational, so it must never act as a control for whatever it sits
        // inside — without this, one placed within a card-wide <Link> navigates when clicked.
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") close();
        }}
        className={`inline-flex cursor-help items-center outline-none focus-visible:ring-2 focus-visible:ring-accent-strong ${
          children ? "" : "rounded-full opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100"
        } ${className}`}
      >
        {children ?? <Info size={size} />}
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
