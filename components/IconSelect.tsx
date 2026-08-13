"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "@/components/icons";

export type IconOption = { value: string; label: string; icon?: React.ReactNode };
export type IconGroup = { label?: string; options: IconOption[] };

/**
 * A select with a face — options carry a mark at the left (a channel logo, a product photo, a
 * glyph), grouped under quiet headers. Same footprint as the standard input so it drops into any
 * Field. Closes on outside click and Escape.
 */
export function IconSelect({
  value,
  onChange,
  groups,
  placeholder = "Select…",
  disabled = false,
  emptyNote = "Nothing to pick here.",
}: {
  value: string;
  onChange: (value: string) => void;
  groups: IconGroup[];
  placeholder?: string;
  disabled?: boolean;
  /** Shown inside the open dropdown when no group has any options. */
  emptyNote?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const selected = groups.flatMap((g) => g.options).find((o) => o.value === value) ?? null;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-full items-center gap-2 rounded-lg border border-border bg-surface px-2.5 text-left text-[13px] text-ink outline-none transition-colors focus:border-accent-strong disabled:opacity-50"
      >
        {selected?.icon && <span className="shrink-0">{selected.icon}</span>}
        <span className="min-w-0 flex-1 truncate">{selected ? selected.label : <span className="text-muted">{placeholder}</span>}</span>
        <ChevronDown size={14} className="shrink-0 text-muted" />
      </button>
      {open && (
        <div className="dropdown-in absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-xl">
          {groups.every((g) => g.options.length === 0) && (
            <div className="px-2.5 py-2 text-[12.5px] text-muted">{emptyNote}</div>
          )}
          {groups
            .filter((g) => g.options.length > 0)
            .map((g, gi) => (
              <div key={gi} className={gi > 0 ? "mt-1 border-t border-line pt-1" : ""}>
                {g.label && (
                  <div className="px-2 pb-1 pt-1.5 text-[10.5px] font-medium uppercase tracking-wide text-muted">{g.label}</div>
                )}
                {g.options.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => {
                      onChange(o.value);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] ${
                      o.value === value ? "bg-surface-2 text-ink" : "text-ink-soft hover:bg-surface-2 hover:text-ink"
                    }`}
                  >
                    {o.icon && <span className="shrink-0">{o.icon}</span>}
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {o.value === value && <Check size={13} className="shrink-0 text-accent" />}
                  </button>
                ))}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
