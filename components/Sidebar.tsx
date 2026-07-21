"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Boxes,
  FlaskConical,
  ArrowLeftRight,
  ShoppingCart,
  FileText,
  Building2,
  Images,
  LogOut,
  Settings,
} from "lucide-react";
import { logout } from "@/app/login/actions";
import { SettingsModal } from "@/components/SettingsModal";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/inventory", label: "Inventory", icon: Boxes },
  { href: "/lots", label: "Production Lots", icon: FlaskConical },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { href: "/purchases", label: "Purchases", icon: ShoppingCart },
  { href: "/purchase-orders", label: "Purchase Orders", icon: FileText },
  { href: "/suppliers", label: "Suppliers", icon: Building2 },
  { href: "/catalog", label: "Catalog", icon: Images },
];

export function Sidebar({ authEnabled = false, onNavigate }: { authEnabled?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <aside className="flex h-full w-[230px] shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex items-center gap-2 px-5 py-5">
        <Image src="/brand/logo.png" alt="herbl" width={86} height={26} className="h-[22px] w-auto" priority />
        {!onNavigate && (
          <span className="ml-auto rounded-md bg-accent-soft px-2 py-0.5 text-[10px] font-semibold tracking-wide text-ink-soft">
            OPS
          </span>
        )}
      </div>

      <nav className="flex-1 px-3 py-2">
        {NAV.map((item) => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={`mb-0.5 flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors ${
                active ? "bg-accent-soft text-ink" : "text-muted hover:bg-surface-2 hover:text-ink-soft"
              }`}
            >
              <Icon size={17} strokeWidth={2} className={active ? "text-ink" : "text-muted"} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {authEnabled && (
        <form action={logout} className="px-3 pb-1">
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink-soft"
          >
            <LogOut size={16} strokeWidth={2} /> Sign out
          </button>
        </form>
      )}

      <div className="flex items-center justify-between border-t border-border px-5 py-4">
        <div>
          <div className="text-[12px] font-medium text-ink-soft">Herbl Inc.</div>
          <div className="text-[11px] text-muted">Production & Inventory</div>
        </div>
        <button
          onClick={() => setSettingsOpen(true)}
          aria-label="Settings"
          title="Settings"
          className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-ink-soft"
        >
          <Settings size={17} strokeWidth={2} />
        </button>
      </div>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </aside>
  );
}
