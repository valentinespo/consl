"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/settings/company", label: "Company & team" },
  { href: "/settings/timezone", label: "Time zone" },
  { href: "/settings/restock", label: "Restock defaults" },
  { href: "/settings/integrations", label: "Integrations" },
];

/** Tab strip for the Settings section. Client-side only so the current tab can be highlighted. */
export function SettingsTabs() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap items-center gap-1" aria-label="Settings sections">
      {TABS.map((t) => {
        const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-lg px-3 py-1.5 text-[13.5px] font-medium transition-colors ${
              active ? "bg-surface-2 text-ink" : "text-muted hover:bg-surface-2/60 hover:text-ink-soft"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
