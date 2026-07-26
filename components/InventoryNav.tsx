"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/inventory", label: "Overview" },
  { href: "/inventory/raw-materials", label: "Raw materials" },
  { href: "/inventory/production", label: "In production" },
];

/** Section tabs, with an optional slot on the right for page-level actions. */
export function InventoryNav({ right }: { right?: React.ReactNode }) {
  const path = usePathname();
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div className="flex gap-1 rounded-xl border border-border bg-surface p-1 sm:w-fit">
      {TABS.map((t) => {
        const active = path === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
              active ? "bg-accent-soft text-accent" : "text-muted hover:text-ink-soft"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
      </div>
      {right}
    </div>
  );
}
