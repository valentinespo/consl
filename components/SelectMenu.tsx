"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "@/components/icons";
import { useExitAnimation } from "@/components/animate";

export type SelectMenuOption = {
  value: string;
  label: string;
  /** Optional leading visual — a channel logo, a SKU avatar, an icon. */
  icon?: ReactNode;
  /** Muted second line under the label (e.g. a facility type's explanation). */
  hint?: string;
};

/**
 * The app's dropdown — replaces native <select> everywhere one shows real content. Portalled and
 * exit-animated like every other popover, panel width follows the trigger, active row in accent,
 * and long lists (> 15) get a type-to-filter box. Options carry optional icons/hints so callers
 * can show channel logos, SKU images, or plain text as fits.
 */
export function SelectMenu({
  value,
  options,
  onChange,
  placeholder = "Select…",
  disabled = false,
  className = "w-full",
  ariaLabel,
}: {
  value: string;
  options: SelectMenuOption[];
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Trigger sizing classes — defaults to w-full; pass an explicit width to bound it instead
   *  (the base carries no width, so yours is the only one that applies). */
  className?: string;
  ariaLabel?: string;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ top: number; left: number; width: number } | null>(null);
  const lastBox = useRef(box);
  if (box) lastBox.current = box;
  const open = box !== null;
  const exit = useExitAnimation(open);
  const [filter, setFilter] = useState("");

  const selected = options.find((o) => o.value === value) ?? null;
  const filterable = options.length > 15;
  const shown = filterable && filter.trim()
    ? options.filter((o) => `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(filter.trim().toLowerCase()))
    : options;

  // The panel can outgrow a narrow trigger (up to 320px) — keep it inside the viewport.
  const clampLeft = (r: DOMRect) => Math.max(8, Math.min(r.left, window.innerWidth - Math.max(r.width, 320) - 8));

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btn.current?.getBoundingClientRect();
      if (r) setBox({ top: r.bottom + 6, left: clampLeft(r), width: r.width });
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setBox(null);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      // The list is portalled — exempt it AND the trigger, or an item press unmounts the list
      // on mousedown and its click never fires.
      if (!btn.current?.contains(t) && !panel.current?.contains(t)) setBox(null);
    };
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  function toggle() {
    if (disabled) return;
    if (open) return setBox(null);
    const r = btn.current!.getBoundingClientRect();
    setFilter("");
    setBox({ top: r.bottom + 6, left: clampLeft(r), width: r.width });
  }

  function choose(v: string) {
    setBox(null);
    if (v !== value) onChange(v);
  }

  return (
    <>
      <button
        ref={btn}
        type="button"
        onClick={toggle}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={`flex h-9 items-center gap-2 rounded-[10px] border border-border bg-surface px-3 text-left text-[13px] text-ink outline-none transition-colors hover:border-ink/25 focus-visible:border-ink/40 disabled:cursor-default disabled:opacity-50 ${className}`}
      >
        {selected?.icon && <span className="shrink-0">{selected.icon}</span>}
        <span className={`min-w-0 flex-1 truncate ${selected ? "" : "text-muted"}`}>{selected?.label ?? placeholder}</span>
        <ChevronDown size={13} className="shrink-0 text-muted" />
      </button>
      {exit.mounted &&
        lastBox.current &&
        createPortal(
          <div
            ref={panel}
            role="listbox"
            aria-label={ariaLabel}
            style={{ position: "fixed", top: lastBox.current.top, left: lastBox.current.left, minWidth: lastBox.current.width, maxWidth: Math.max(lastBox.current.width, 320) }}
            className={`${exit.closing ? "dropdown-out" : "dropdown-in"} z-[300] rounded-xl border border-border bg-surface p-1 shadow-xl`}
          >
            {filterable && (
              <div className="relative mb-1 border-b border-border px-1 pb-1">
                <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-[calc(50%+2px)] text-muted" />
                <input
                  autoFocus
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter…"
                  className="w-full rounded-lg bg-transparent py-1.5 pl-7 pr-2 text-[13px] text-ink outline-none placeholder:text-muted"
                />
              </div>
            )}
            <div className="max-h-64 overflow-y-auto">
              {shown.length === 0 && <div className="px-2.5 py-2 text-[12.5px] text-muted">No matches.</div>}
              {shown.map((o) => {
                const active = o.value === value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => choose(o.value)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                      active ? "bg-chart-soft font-medium text-chart" : "text-ink-soft hover:bg-surface-2 hover:text-ink"
                    }`}
                  >
                    {o.icon && <span className="shrink-0">{o.icon}</span>}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{o.label}</span>
                      {o.hint && <span className="block truncate text-[11.5px] font-normal text-muted">{o.hint}</span>}
                    </span>
                    {active && <Check size={13} className="shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
