"use client";

import { useState } from "react";

export type Opt = { value: string; label: string };

const inputCls = "h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-accent-strong";

/**
 * A select that also lets you create a new option inline. The chosen value is mirrored
 * into a hidden input (`name`) so it submits with the surrounding form.
 */
export function SelectOrCreate({
  name,
  value,
  onChange,
  options,
  placeholder,
  createPlaceholder = "Type a name…",
  onCreate,
  onCreatingChange,
}: {
  name?: string;
  value: string;
  onChange: (v: string) => void;
  options: Opt[];
  placeholder?: string;
  createPlaceholder?: string;
  // When omitted, the "Create new…" option is hidden — the control becomes a plain picker.
  // May return { error } to surface a real reason (e.g. "Code CCP already exists") inline.
  onCreate?: (text: string) => Promise<Opt | { error: string } | null>;
  // Fires when the inline-create input opens/closes, so a tight parent cell can widen itself.
  onCreatingChange?: (creating: boolean) => void;
}) {
  // Locally-created options are kept separately so the list stays reactive to `options`
  // changing (e.g. SKU choices update when the selected lot changes).
  const [created, setCreated] = useState<Opt[]>([]);
  const opts = [...options, ...created.filter((c) => !options.some((o) => o.value === c.value))];
  const [creating, setCreatingRaw] = useState(false);
  const setCreating = (v: boolean) => {
    setCreatingRaw(v);
    onCreatingChange?.(v);
  };
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!text.trim() || !onCreate) return;
    setPending(true);
    setError(null);
    const opt = await onCreate(text.trim());
    setPending(false);
    if (!opt || "error" in opt) {
      setError(opt && "error" in opt ? opt.error : "Couldn't create");
      return;
    }
    setCreated((prev) => (prev.some((o) => o.value === opt.value) ? prev : [...prev, opt]));
    onChange(opt.value);
    setCreating(false);
    setText("");
  }

  if (creating) {
    return (
      <div>
        <div className="flex gap-1.5">
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                create();
              }
            }}
            placeholder={createPlaceholder}
            className={inputCls}
          />
          <button
            type="button"
            onClick={create}
            disabled={pending || !text.trim()}
            className="shrink-0 rounded-lg bg-ink px-3 text-[12.5px] font-medium text-bg hover:opacity-90 disabled:opacity-40"
          >
            {pending ? "…" : "Create"}
          </button>
          <button
            type="button"
            onClick={() => {
              setCreating(false);
              setText("");
            }}
            className="shrink-0 rounded-lg border border-border px-2.5 text-[12.5px] text-muted hover:bg-surface-2"
          >
            ✕
          </button>
        </div>
        {error && <div className="mt-1 text-[11px] text-negative">{error}</div>}
      </div>
    );
  }

  return (
    <>
      {name && <input type="hidden" name={name} value={value} />}
      <select
        value={value}
        onChange={(e) => (e.target.value === "__create__" ? setCreating(true) : onChange(e.target.value))}
        className={inputCls}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
        {onCreate && <option value="__create__">＋ Create new…</option>}
      </select>
    </>
  );
}
