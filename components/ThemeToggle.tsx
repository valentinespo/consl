"use client";

import { useEffect, useState } from "react";
import { Moon, Monitor, Sun } from "lucide-react";

type Pref = "light" | "dark" | "system";
const ORDER: Pref[] = ["light", "dark", "system"];
const LABEL: Record<Pref, string> = { light: "Light", dark: "Dark", system: "System" };

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

/** Cycles Light → Dark → System. System tracks the OS setting live, so flipping the computer's
 *  appearance flips the app without a reload. */
export function ThemeToggle() {
  // Starts null so the server and the first client render agree; the icon appears after mount.
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

  function cycle() {
    const next = ORDER[(ORDER.indexOf(pref ?? "system") + 1) % ORDER.length];
    setPref(next);
    localStorage.setItem("so-theme", next);
    apply(next);
  }

  const Icon = pref === "dark" ? Moon : pref === "light" ? Sun : Monitor;
  return (
    <button
      onClick={cycle}
      title="Switch between light, dark and system theme"
      aria-label={pref ? `Theme: ${LABEL[pref]} — click to change` : "Theme"}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/15 bg-white/10 px-2.5 text-[12px] font-medium text-white/85 transition-colors hover:bg-white/15 hover:text-white"
    >
      {/* min-width keeps the pill from jumping while the saved preference loads */}
      <span className="inline-flex min-w-[86px] items-center justify-center gap-1.5">
        {pref && (
          <>
            <Icon size={14} />
            {LABEL[pref]} theme
          </>
        )}
      </span>
    </button>
  );
}
