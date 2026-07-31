"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import { UserButton } from "@clerk/nextjs";
import { Menu, Search } from "@/components/icons";
import { OrgSwitcher } from "@/components/OrgSwitcher";
import { NotificationsBell } from "@/components/NotificationsBell";
import type { MyOrg } from "@/lib/orgs";

/**
 * The top strip of the chrome — same gray as the sidebar so the two read as one merged surface,
 * with the white page floating to the right below. Left: the iso mark, a hairline, and the company
 * switcher. Centre: search (⌘K focuses it — it types, it just doesn't search yet; it's holding the
 * spot where app-wide search and later an assistant will live). Right: the notification bell and
 * the account avatar.
 */
export function AppHeader({ onMenu, orgs = [] }: { onMenu?: () => void; orgs?: MyOrg[] }) {
  const searchRef = useRef<HTMLInputElement>(null);

  // ⌘K (or Ctrl+K) jumps to search from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="chrome-blur flex h-14 shrink-0 items-center gap-3 px-3 sm:grid sm:grid-cols-[1fr_minmax(0,560px)_1fr] sm:gap-4">
      <div className="flex min-w-0 items-center gap-2">
        {onMenu && (
          <button
            onClick={onMenu}
            aria-label="Open menu"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-soft hover:bg-surface hover:text-ink lg:hidden"
          >
            <Menu size={19} />
          </button>
        )}
        <Image
          src="/brand/iso-black.png"
          alt="SellerOps"
          width={1260}
          height={1524}
          priority
          className="iso-invert ml-1 h-7 w-auto shrink-0"
        />
        <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-border" />
        <OrgSwitcher orgs={orgs} variant="header" />
      </div>

      <div className="relative min-w-0 flex-1 sm:flex-none">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          ref={searchRef}
          type="text"
          placeholder="Search"
          aria-label="Search (coming soon)"
          className="h-9 w-full rounded-lg border border-border bg-surface pl-8.5 pr-12 text-[13px] text-ink outline-none transition-colors placeholder:text-muted focus:border-accent-strong"
        />
        <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden h-5 -translate-y-1/2 items-center gap-0.5 rounded border border-border bg-surface-2 px-1.5 font-sans text-[10.5px] font-medium text-muted sm:flex">
          ⌘K
        </kbd>
      </div>

      <div className="flex items-center justify-end gap-2.5">
        <NotificationsBell />
        <span aria-hidden className="h-5 w-px shrink-0 bg-border" />
        <span className="flex items-center">
          <UserButton appearance={{ elements: { avatarBox: "h-8 w-8", userButtonPopoverCard: "org-pop" } }} />
        </span>
      </div>
    </header>
  );
}
