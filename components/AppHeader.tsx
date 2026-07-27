"use client";

import Image from "next/image";
import { Menu, Search } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";

/**
 * The midnight-navy bar across the top: theme toggle, the white wordmark, and a centred search
 * box. The search deliberately isn't wired to anything yet — it types, it just doesn't search.
 * It's holding the spot where app-wide search (and later an assistant) will live.
 */
export function AppHeader({ onMenu }: { onMenu?: () => void }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 bg-header px-3 sm:grid sm:grid-cols-[1fr_minmax(0,560px)_1fr] sm:gap-4">
      <div className="flex items-center gap-1">
        {onMenu && (
          <button
            onClick={onMenu}
            aria-label="Open menu"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-white/75 hover:bg-white/10 hover:text-white lg:hidden"
          >
            <Menu size={19} />
          </button>
        )}
        <Image
          src="/brand/logo-white-2.png"
          alt="SellerOps"
          width={1882}
          height={400}
          priority
          className="ml-1 h-[19px] w-auto"
        />
      </div>

      <div className="relative min-w-0 flex-1 sm:flex-none">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/45" />
        <input
          type="text"
          placeholder="Search"
          aria-label="Search (coming soon)"
          className="h-8 w-full rounded-lg border border-white/15 bg-white/10 pl-8.5 pr-3 text-[13px] text-white outline-none transition-colors placeholder:text-white/45 focus:border-white/35 focus:bg-white/[0.14]"
        />
      </div>

      <div className="flex items-center justify-end">
        <ThemeToggle />
      </div>
    </header>
  );
}
