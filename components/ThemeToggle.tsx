"use client";

import { useEffect, useState } from "react";
import { Moon, Monitor, Sun } from "lucide-react";

type Pref = "light" | "dark" | "system";
const ORDER: Pref[] = ["light", "dark", "system"];
const LABEL: Record<Pref, string> = { light: "Light", dark: "Dark", system: "System" };

/** Resolve the preference to an actual theme and stamp it on <html>. Mirrors the inline script in
 *  the root layout — the script wins the first paint, this keeps later changes in sync. */
function apply(pref: Pref) {
  const dark =
    pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const el = document.documentElement;
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
      title={pref ? `Theme: ${LABEL[pref]} — click to change` : "Theme"}
      aria-label={pref ? `Theme: ${LABEL[pref]}` : "Theme"}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-white/75 transition-colors hover:bg-white/10 hover:text-white"
    >
      {pref && <Icon size={16} />}
    </button>
  );
}
