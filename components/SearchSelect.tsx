"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Check, Plus } from "lucide-react";

/** Searchable, optionally creatable select over string values. Mirrors value to a hidden input. */
export function SearchSelect({
  name,
  value,
  onChange,
  options,
  placeholder = "Select…",
  allowCreate = true,
  createLabel = (t: string) => `Create “${t}”`,
}: {
  name?: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  allowCreate?: boolean;
  createLabel?: (text: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const filtered = options.filter((o) => o.toLowerCase().includes(query.trim().toLowerCase()));
  const showCreate = allowCreate && query.trim() && !options.some((o) => o.toLowerCase() === query.trim().toLowerCase());

  function pick(v: string) {
    onChange(v);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={ref} className="relative">
      {name && <input type="hidden" name={name} value={value} />}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-full items-center justify-between rounded-lg border border-border bg-surface px-2.5 text-[13px] outline-none focus:border-accent-strong"
      >
        <span className={value ? "text-ink" : "text-muted"}>{value || placeholder}</span>
        <ChevronDown size={15} className="text-muted" />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
          <div className="border-b border-line p-1.5">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-[13px] outline-none focus:border-accent-strong"
            />
          </div>
          <div className="max-h-48 overflow-y-auto p-1">
            {filtered.map((o) => (
              <button
                type="button"
                key={o}
                onClick={() => pick(o)}
                className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[13px] text-ink hover:bg-surface-2"
              >
                {o}
                {o === value && <Check size={14} className="text-positive" />}
              </button>
            ))}
            {showCreate && (
              <button
                type="button"
                onClick={() => pick(query.trim())}
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[13px] font-medium text-positive hover:bg-surface-2"
              >
                <Plus size={14} /> {createLabel(query.trim())}
              </button>
            )}
            {filtered.length === 0 && !showCreate && <div className="px-2 py-2 text-[12.5px] text-muted">No matches</div>}
          </div>
        </div>
      )}
    </div>
  );
}
