"use client";

import { useEffect, useState } from "react";
import { Moon, Monitor, Sun } from "@/components/icons";
import type { LucideIcon } from "@/components/icons";

type Pref = "light" | "dark" | "system";
const ORDER: Pref[] = ["light", "dark", "system"];
const SEGMENTS: { pref: Pref; label: string; icon: LucideIcon }[] = [
  { pref: "light", label: "Light", icon: Sun },
  { pref: "dark", label: "Dark", icon: Moon },
  { pref: "system", label: "System", icon: Monitor },
];

let fadeTimer: ReturnType<typeof setTimeout> | undefined;

/** Resolve the preference to an actual theme and stamp it on <html>. Mirrors the inline script in
 *  the root layout — the script wins the first paint, this keeps later changes in sync. */
function apply(pref: Pref) {
  const dark =
    pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const el = document.documentElement;
  // Cross-fade the switch: the class turns on colour transitions everywhere for just long enough
  // for the token flip to glide. First paint never fades — only apply() is ever this path.
  el.classList.add("theme-fade");
  clearTimeout(fadeTimer);
  fadeTimer = setTimeout(() => el.classList.remove("theme-fade"), 400);
  el.dataset.theme = dark ? "dark" : "light";
  el.style.colorScheme = dark ? "dark" : "light"; // native controls (date pickers, selects) follow
}

/** Three-way Light / Dark / System switch, sized like a search bar — lives at the top of the
 *  sidebar. System tracks the OS setting live, so flipping the computer's appearance flips the
 *  app without a reload. */
export function ThemeToggle() {
  // Starts null so the server and the first client render agree; the active segment lights after mount.
  const [pref, setPref] = useState<Pref | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("so-theme") as Pref | null;
    setPref(stored && ORDER.includes(stored) ? stored : "system");
  }, []);

  useEffect(() => {
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = () => apply("system");
    mq.addEventListener("change", follow);
    return () => mq.removeEventListener("change", follow);
  }, [pref]);

  function choose(next: Pref) {
    setPref(next);
    localStorage.setItem("so-theme", next);
    apply(next);
  }

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="flex h-9 w-full items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5"
    >
      {SEGMENTS.map(({ pref: p, label, icon: Icon }) => {
        const active = pref === p;
        return (
          <button
            key={p}
            role="radio"
            aria-checked={active}
            onClick={() => choose(p)}
            className={`flex h-full flex-1 items-center justify-center gap-1 rounded-md text-[11.5px] transition-colors ${
              active ? "bg-surface-2 font-medium text-ink" : "text-muted hover:text-ink-soft"
            }`}
          >
            <Icon size={13} />
            {label}
          </button>
        );
      })}
    </div>
  );
}
