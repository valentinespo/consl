"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboardFilled,
  BoxesFilled,
  FlaskConicalFilled,
  ArrowLeftRightFilled,
  ShoppingCartFilled,
  FileTextFilled,
  Building2Filled,
  WarehouseFilled,
  ImagesFilled,
  Settings,
} from "@/components/icons";
import { ThemeToggle } from "@/components/ThemeToggle";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboardFilled, exact: true, resource: "dashboard" },
  { href: "/inventory", label: "Inventory", icon: BoxesFilled, resource: "inventory" },
  { href: "/lots", label: "Production Lots", icon: FlaskConicalFilled, resource: "lots" },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRightFilled, resource: "transactions" },
  { href: "/purchases", label: "Purchases", icon: ShoppingCartFilled, resource: "purchases" },
  { href: "/purchase-orders", label: "Purchase Orders", icon: FileTextFilled, resource: "purchaseOrders" },
  { href: "/suppliers", label: "Suppliers", icon: Building2Filled, resource: "suppliers" },
  { href: "/facilities", label: "Facilities", icon: WarehouseFilled, resource: "facilities" },
  { href: "/catalog", label: "Catalog", icon: ImagesFilled, resource: "catalog" },
];

/** The nav column. Same gray as the top strip — no border, the two are one merged chrome surface;
 *  the white page beside it carries its own edge. The company switcher and account avatar live in
 *  the top strip now; this keeps the theme switch up top and settings at the foot. */
export function Sidebar({
  orgName,
  allowed = null,
  onNavigate,
}: {
  orgName?: string | null;
  allowed?: string[] | null;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  // null = don't filter (owner or a resolution hiccup — page guards still enforce). Otherwise a
  // section only appears when the member may view it.
  const canView = (resource: string) => allowed === null || allowed.includes(resource);
  const nav = NAV.filter((item) => canView(item.resource));

  return (
    <aside className="flex h-full w-[230px] shrink-0 flex-col overflow-y-auto bg-sidebar">
      {/* Theme switch sits where a sidebar search would — a full-width control, not a pill. */}
      <div className="px-3 pb-1 pt-3">
        <ThemeToggle />
      </div>

      <nav className="flex-1 px-3 py-2">
        {nav.map((item) => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={`mb-0.5 flex items-center gap-3 rounded-lg px-3 py-1.5 text-[13.5px] font-medium transition-colors ${
                active ? "bg-nav-active text-ink" : "text-muted hover:bg-surface-2 hover:text-ink-soft"
              }`}
            >
              <Icon size={19} strokeWidth={2} className={active ? "text-ink" : "text-muted"} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex items-center justify-between px-4 py-4">
        <div className="min-w-0">
          <div className="truncate text-[12px] font-medium text-ink-soft">{orgName ?? "Your company"}</div>
          <div className="text-[11px] text-muted">Production &amp; Inventory</div>
        </div>
        {canView("settings") && (
          <Link
            href="/settings"
            onClick={onNavigate}
            aria-label="Settings"
            title="Settings"
            className="shrink-0 rounded-lg p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-ink-soft"
          >
            <Settings size={17} strokeWidth={2} />
          </Link>
        )}
      </div>
    </aside>
  );
}
