"use client";

import { useEffect, useState } from "react";

/**
 * Keeps a closing element mounted just long enough to play its exit animation.
 * `mounted` is what you render on; `closing` picks the -out class. When `open`
 * flips false the element stays mounted for `ms`, then unmounts.
 */
export function useExitAnimation(open: boolean, ms = 150): { mounted: boolean; closing: boolean } {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    if (!mounted) return;
    const t = setTimeout(() => setMounted(false), ms);
    return () => clearTimeout(t);
  }, [open, ms, mounted]);
  return { mounted, closing: mounted && !open };
}

/** An expandable table row that eases in on open and eases back out on close. */
export function ExpandRow({ open, className = "", children }: { open: boolean; className?: string; children: React.ReactNode }) {
  const { mounted, closing } = useExitAnimation(open);
  if (!mounted) return null;
  return <tr className={`${closing ? "dropdown-out" : "dropdown-in"} ${className}`}>{children}</tr>;
}
