"use client";

import { useEffect, useRef, useState } from "react";
import { useExitAnimation } from "@/components/animate";
import { ChevronDown, Check, Plus, CornerDownLeft } from "@/components/icons";

/**
 * Searchable, optionally creatable select over string values. Mirrors value to a hidden input.
 *
 * "Create new" sits at the bottom of the list at all times, not only once the search text fails
 * to match — otherwise adding something requires knowing in advance that typing an unknown name
 * is what reveals the option. Clicking it turns the search box into a name field, so the same
 * control both filters and creates.
 */
export function SearchSelect({
  name,
  value,
  onChange,
  options,
  placeholder = "Select…",
  allowCreate = true,
  createLabel = "Create new",
  createPlaceholder = "Name it, then press Enter",
}: {
  name?: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  allowCreate?: boolean;
  /** Label for the always-present row, e.g. "Create new supplier". */
  createLabel?: string;
  createPlaceholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const panel = useExitAnimation(open);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  function close() {
    setOpen(false);
    setCreating(false);
    setQuery("");
  }

  const q = query.trim();
  const filtered = options.filter((o) => o.toLowerCase().includes(q.toLowerCase()));
  const exists = options.some((o) => o.toLowerCase() === q.toLowerCase());

  function pick(v: string) {
    onChange(v);
    close();
  }

  /** Commit whatever is typed as a new value. */
  function commitNew() {
    if (!q || exists) return;
    pick(q);
  }

  function startCreating() {
    setCreating(true);
    // Keep anything already typed — it's almost certainly the name they want.
    requestAnimationFrame(() => field.current?.focus());
  }

  return (
    <div ref={ref} className="relative">
      {name && <input type="hidden" name={name} value={value} />}
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        className="flex h-9 w-full items-center justify-between rounded-lg border border-border bg-surface px-2.5 text-[13px] outline-none focus:border-accent-strong"
      >
        <span className={value ? "text-ink" : "text-muted"}>{value || placeholder}</span>
        <ChevronDown size={15} className="text-muted" />
      </button>

      {panel.mounted && (
        <div className={`${panel.closing ? "dropdown-out" : "dropdown-in"} absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface shadow-lg`}>
          <div className="border-b border-line p-1.5">
            <input
              ref={field}
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (creating || !exists) commitNew();
                  else if (filtered.length > 0) pick(filtered[0]);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  close();
                }
              }}
              placeholder={creating ? createPlaceholder : "Search…"}
              className={`h-8 w-full rounded-md border px-2 text-[13px] outline-none ${
                creating
                  ? "border-accent-strong bg-surface text-ink"
                  : "border-border bg-surface-2 focus:border-accent-strong"
              }`}
            />
          </div>

          {creating ? (
            <div className="p-1">
              <button
                type="button"
                onClick={commitNew}
                disabled={!q || exists}
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[13px] font-medium text-accent hover:bg-surface-2 disabled:opacity-45 disabled:hover:bg-transparent"
              >
                <Plus size={14} />
                {q ? `Create “${q}”` : "Type a name above"}
                {q && !exists && <CornerDownLeft size={13} className="ml-auto text-muted" />}
              </button>
              {exists && q && (
                <div className="px-2 py-1.5 text-[12px] text-muted">“{q}” already exists — pick it from the list.</div>
              )}
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="mt-0.5 w-full rounded-md px-2 py-1.5 text-left text-[12.5px] text-muted hover:bg-surface-2"
              >
                Back to the list
              </button>
            </div>
          ) : (
            <div className="max-h-48 overflow-y-auto p-1">
              {filtered.map((o) => (
                <button
                  type="button"
                  key={o}
                  onClick={() => pick(o)}
                  className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[13px] text-ink hover:bg-surface-2"
                >
                  {o}
                  {o === value && <Check size={14} className="text-accent" />}
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="px-2 py-2 text-[12.5px] text-muted">
                  {q ? "No matches" : "Nothing here yet"}
                </div>
              )}

              {allowCreate && (
                <>
                  <div className="my-1 border-t border-line" />
                  <button
                    type="button"
                    // A typed name IS the answer — create it in one click; the two-step naming
                    // view only appears when there is nothing typed yet.
                    onClick={q && !exists ? commitNew : startCreating}
                    className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[13px] font-medium text-accent hover:bg-surface-2"
                  >
                    <Plus size={14} />
                    {q && !exists ? `Create “${q}”` : createLabel}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
