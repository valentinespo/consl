"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Buildings, Check, ChevronDown, Layers, Package, Tag, Truck, Warehouse } from "@/components/icons";
import { useExitAnimation } from "@/components/animate";
import type { Choice } from "@/components/apply/options";

/**
 * Form primitives for the early-access questionnaire. Deliberately light-only, in the same
 * neutral-and-violet palette as the marketing page (not the app's theme tokens): this is a public
 * page that must look identical to every visitor, and its dropdown must not inherit a dark theme
 * from the app shell. Hairline borders, one accent, no gradients.
 */

export const PRIMARY =
  "inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-violet-600 px-6 text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-violet-200 disabled:shadow-none";
export const GHOST =
  "inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white px-5 text-[15px] font-semibold text-neutral-700 transition-colors hover:border-neutral-300 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40";

export const fieldCls =
  "h-12 w-full rounded-xl border border-neutral-200 bg-white px-4 text-[15px] text-neutral-900 outline-none transition-[border-color,box-shadow] placeholder:text-neutral-400 focus:border-violet-500 focus:ring-4 focus:ring-violet-500/10";
const labelCls = "mb-1.5 block text-[13px] font-medium text-neutral-700";

/** The highlighted phrase inside a question. */
export function Em({ children }: { children: ReactNode }) {
  return <span className="text-violet-700">{children}</span>;
}

export function Heading({ title, sub }: { title: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      <h1 className="text-[30px] font-bold leading-[1.12] tracking-tight text-neutral-900 sm:text-[36px]">{title}</h1>
      {sub && <p className="mt-3 max-w-[560px] text-[15.5px] leading-relaxed text-neutral-600">{sub}</p>}
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  autoFocus,
  autoComplete,
  inputMode,
  error,
  trailing,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  autoFocus?: boolean;
  autoComplete?: string;
  inputMode?: "text" | "email" | "tel" | "numeric";
  /** Shown once the visitor has typed something invalid and moved on. */
  error?: string | null;
  trailing?: ReactNode;
}) {
  const [touched, setTouched] = useState(false);
  const show = touched && !!error;
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      <span className="relative block">
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          autoComplete={autoComplete}
          inputMode={inputMode}
          aria-invalid={show || undefined}
          className={`${fieldCls} ${show ? "border-red-400 focus:border-red-400 focus:ring-red-500/10" : ""} ${trailing ? "pr-16" : ""}`}
        />
        {trailing && <span className="absolute inset-y-0 right-3 flex items-center">{trailing}</span>}
      </span>
      {show && <span className="mt-1.5 block text-[12.5px] text-red-600">{error}</span>}
    </label>
  );
}

export function TextArea({
  label,
  value,
  onChange,
  placeholder,
  rows = 5,
  minChars,
  autoFocus,
  hint,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  /** Shows a live counter that turns green once the minimum is met. */
  minChars?: number;
  autoFocus?: boolean;
  hint?: string;
}) {
  const len = value.trim().length;
  const met = minChars ? len >= minChars : true;
  return (
    <label className="block">
      {label && <span className={labelCls}>{label}</span>}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        autoFocus={autoFocus}
        className={`${fieldCls} h-auto resize-y py-3 leading-relaxed`}
      />
      <span className="mt-1.5 flex items-center justify-between text-[12.5px]">
        <span className="text-neutral-500">{hint}</span>
        {minChars && (
          <span className={`tabular-nums ${met ? "font-medium text-emerald-600" : "text-neutral-500"}`}>
            {met ? <Check size={12} className="mr-1 inline-block" /> : null}
            {len} / {minChars} min
          </span>
        )}
      </span>
    </label>
  );
}

/** The platform tile beside an option: a real mark, a monogram, or a glyph — always on the same
 *  white, hairlined 36px square so a mixed list reads as one set. */
export function Mark({ choice, size = 36 }: { choice: Choice; size?: number }) {
  const glyph = {
    buildings: <Buildings size={17} />,
    truck: <Truck size={17} />,
    package: <Package size={17} />,
    warehouse: <Warehouse size={17} />,
    tag: <Tag size={16} />,
    layers: <Layers size={16} />,
  } as const;
  return (
    <span
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-neutral-200 bg-white text-neutral-700"
    >
      {choice.mark ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={choice.mark} alt="" className="h-full w-full object-contain p-1" />
      ) : choice.mono ? (
        <span className="text-[12px] font-bold tracking-tight text-neutral-800">{choice.mono}</span>
      ) : choice.icon ? (
        glyph[choice.icon]
      ) : null}
    </span>
  );
}

/** One selectable card — the questionnaire's answer unit. Radio dot for single choice, a square
 *  for multi. Selected state is a violet edge and the faintest wash, nothing louder. */
export function ChoiceCard({
  selected,
  onClick,
  label,
  hint,
  leading,
  multi = false,
  trailing,
  compact = false,
}: {
  selected: boolean;
  onClick: () => void;
  label: ReactNode;
  hint?: ReactNode;
  leading?: ReactNode;
  multi?: boolean;
  trailing?: ReactNode;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      role={multi ? "checkbox" : "radio"}
      aria-checked={selected}
      aria-label={typeof label === "string" ? label : undefined}
      onClick={onClick}
      className={`group flex w-full items-center gap-3.5 rounded-2xl border bg-white text-left transition-[border-color,background-color,box-shadow] ${
        compact ? "px-4 py-3" : "px-4 py-3.5"
      } ${
        selected
          ? "border-violet-500 bg-violet-50/40 shadow-[0_0_0_1px_#7c3aed]"
          : "border-neutral-200 hover:border-neutral-300"
      }`}
    >
      <span
        aria-hidden
        className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center border-2 transition-colors ${
          multi ? "rounded-[5px]" : "rounded-full"
        } ${selected ? "border-violet-600 bg-violet-600" : "border-neutral-300 group-hover:border-neutral-400"}`}
      >
        {selected && (multi ? <Check size={11} className="text-white" /> : <span className="h-[6px] w-[6px] rounded-full bg-white" />)}
      </span>
      {leading}
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium text-neutral-900">{label}</span>
        {hint && <span className="block text-[12.5px] text-neutral-500">{hint}</span>}
      </span>
      {trailing}
    </button>
  );
}

/** A grid of choice cards driven by a Choice list, with the "other" text box folded in. */
export function ChoiceGrid({
  choices,
  value,
  onToggle,
  multi = true,
  other,
  onOther,
  otherPlaceholder = "Which one?",
  columns = 2,
}: {
  choices: Choice[];
  value: string[];
  onToggle: (key: string) => void;
  multi?: boolean;
  other?: string;
  onOther?: (v: string) => void;
  otherPlaceholder?: string;
  columns?: 1 | 2;
}) {
  const showOther = value.includes("other") && onOther;
  return (
    <div>
      <div className={`grid gap-2.5 ${columns === 2 ? "sm:grid-cols-2" : ""}`}>
        {choices.map((c) => (
          <ChoiceCard
            key={c.key}
            multi={multi}
            selected={value.includes(c.key)}
            onClick={() => onToggle(c.key)}
            label={c.label}
            hint={c.hint}
            leading={c.mark || c.mono || c.icon ? <Mark choice={c} /> : undefined}
          />
        ))}
      </div>
      {showOther && (
        <div className="step-in mt-3">
          <input
            value={other ?? ""}
            onChange={(e) => onOther?.(e.target.value)}
            placeholder={otherPlaceholder}
            autoFocus
            className={fieldCls}
          />
        </div>
      )}
    </div>
  );
}

/**
 * The questionnaire's dropdown — the app's SelectMenu recipe (hairline panel, violet active row,
 * slide-in) rebuilt light-only and un-portalled so it can never pick up the app theme. Full
 * keyboard support: arrows move, Enter picks, Escape closes, typing a letter jumps.
 */
export function Dropdown({
  label,
  value,
  options,
  onChange,
  placeholder = "Choose one",
  autoFocus,
}: {
  label?: string;
  value: string;
  options: Choice[];
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const exit = useExitAnimation(open);
  const selected = options.find((o) => o.key === value) ?? null;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function show() {
    setHi(Math.max(0, options.findIndex((o) => o.key === value)));
    setOpen(true);
  }
  function pick(k: string) {
    onChange(k);
    setOpen(false);
    btn.current?.focus();
  }
  function onKey(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        show();
      }
      return;
    }
    if (e.key === "Escape") return void setOpen(false);
    if (e.key === "ArrowDown") return void (e.preventDefault(), setHi((h) => Math.min(options.length - 1, h + 1)));
    if (e.key === "ArrowUp") return void (e.preventDefault(), setHi((h) => Math.max(0, h - 1)));
    if (e.key === "Enter" || e.key === " ") return void (e.preventDefault(), pick(options[hi].key));
    if (e.key === "Tab") return void setOpen(false);
    if (e.key.length === 1) {
      const i = options.findIndex((o) => o.label.toLowerCase().startsWith(e.key.toLowerCase()));
      if (i >= 0) setHi(i);
    }
  }

  return (
    <div ref={wrap} className="relative">
      {label && <span className={labelCls}>{label}</span>}
      <button
        ref={btn}
        type="button"
        autoFocus={autoFocus}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKey}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={label ?? placeholder}
        className={`${fieldCls} flex items-center justify-between gap-3 text-left ${open ? "border-violet-500 ring-4 ring-violet-500/10" : ""}`}
      >
        <span className={`truncate ${selected ? "text-neutral-900" : "text-neutral-400"}`}>{selected?.label ?? placeholder}</span>
        <ChevronDown size={16} className={`shrink-0 text-neutral-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {exit.mounted && (
        <div
          id={listId}
          role="listbox"
          aria-activedescendant={`${listId}-${options[hi]?.key}`}
          className={`${exit.closing ? "dropdown-out pointer-events-none" : "dropdown-in"} absolute left-0 right-0 top-[calc(100%+6px)] z-30 max-h-[320px] overflow-y-auto rounded-xl border border-neutral-200 bg-white p-1.5 shadow-[0_24px_60px_-24px_rgba(23,23,23,0.35)]`}
        >
          {options.map((o, i) => {
            const active = o.key === value;
            const lit = i === hi;
            return (
              <button
                key={o.key}
                id={`${listId}-${o.key}`}
                type="button"
                role="option"
                aria-selected={active}
                onMouseEnter={() => setHi(i)}
                onClick={() => pick(o.key)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[14.5px] transition-colors ${
                  active ? "font-medium text-violet-700" : "text-neutral-700"
                } ${lit ? (active ? "bg-violet-50" : "bg-neutral-100") : active ? "bg-violet-50/60" : ""}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{o.label}</span>
                  {o.hint && <span className="block truncate text-[12px] font-normal text-neutral-500">{o.hint}</span>}
                </span>
                {active && <Check size={14} className="shrink-0 text-violet-600" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** A quiet inline notice — the form's only "error" surface besides field messages. */
export function Notice({ tone = "neutral", children }: { tone?: "neutral" | "error" | "success"; children: ReactNode }) {
  const cls =
    tone === "error"
      ? "border-red-200 bg-red-50 text-red-700"
      : tone === "success"
        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : "border-neutral-200 bg-neutral-50 text-neutral-700";
  return <div className={`rounded-xl border px-4 py-3 text-[13.5px] leading-relaxed ${cls}`}>{children}</div>;
}

/** The consl wordmark, light-only, for the public flow. */
export function Wordmark({ size = 26 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/consl-mark.png" alt="" style={{ height: size, width: size }} className="object-contain" />
      <span className="text-[19px] font-bold tracking-tight text-neutral-900">consl</span>
    </span>
  );
}
