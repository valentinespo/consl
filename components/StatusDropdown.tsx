"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "@/components/icons";

// Each status value → its frosted pill class (the design-system tokens, so both themes follow).
export const PILL_CLS: Record<string, string> = {
  IN_PRODUCTION: "pill-chart",
  FINISHED: "pill-green",
  PAID: "pill-green",
  DUE: "pill-amber",
};

export type StatusOption = { value: string; label: string };

/** A frosted pill that is ALSO a dropdown — the button hugs its own text (a native <select> would
 *  size to its widest option), the menu renders in a portal so table/card overflow can't clip it.
 *  Changes are STAGED by the caller (violet ring marks an unsaved edit), never saved directly. */
export function StatusDropdown({
  value,
  edited,
  options,
  onChange,
}: {
  value: string;
  edited: boolean;
  options: StatusOption[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const cur = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    document.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    const r = ref.current!.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: r.left });
    setOpen((o) => !o);
  };

  return (
    <span ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={toggle}
        className={`${PILL_CLS[value] ?? "pill-neutral"} inline-flex items-center gap-1 whitespace-nowrap rounded-full border py-0.5 pl-2.5 pr-2 text-[11px] font-medium ${edited ? "ring-2 ring-accent/40" : ""}`}
      >
        {cur.label}
        <ChevronDown size={11} className="opacity-60" />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 60 }}
            onClick={(e) => e.stopPropagation()}
            className="min-w-[9rem] overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-lg"
          >
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(o.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] hover:bg-surface-2 ${o.value === value ? "font-medium text-ink" : "text-ink-soft"}`}
              >
                <span className={`${PILL_CLS[o.value] ?? "pill-neutral"} h-2 w-2 rounded-full border`} />
                {o.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </span>
  );
}
