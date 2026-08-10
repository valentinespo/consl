"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboardFilled,
  BoxesFilled,
  FlaskConicalFilled,
  ArrowLeftRightFilled,
  ShoppingCartFilled,
  ReceiptFilled,
  Building2Filled,
  WarehouseFilled,
  ImagesFilled,
  ReorderFilled,
  OrdersFilled,
  ChevronDown,
  Plug,
  Settings,
  type LucideIcon,
} from "@/components/icons";
import { ThemeToggle } from "@/components/ThemeToggle";

type NavItem = { href: string; label: string; icon: LucideIcon; exact?: boolean; resource: string };

// Analytics — sales and the profit tracking built on it. Sits above Production, never collapsed.
const ANALYTICS_NAV: NavItem[] = [{ href: "/orders", label: "Orders", icon: OrdersFilled, resource: "dashboard" }];

// Production — the day-to-day operational tabs. Collapsible as a group.
const PRODUCTION_NAV: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboardFilled, exact: true, resource: "dashboard" },
  { href: "/inventory", label: "Inventory", icon: BoxesFilled, resource: "inventory" },
  { href: "/reorder", label: "Reorder", icon: ReorderFilled, resource: "inventory" },
  { href: "/lots", label: "Production Lots", icon: FlaskConicalFilled, resource: "lots" },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRightFilled, resource: "transactions" },
  { href: "/purchases", label: "Purchases", icon: ShoppingCartFilled, resource: "purchases" },
  { href: "/purchase-orders", label: "Purchase Orders", icon: ReceiptFilled, resource: "purchaseOrders" },
  { href: "/suppliers", label: "Suppliers", icon: Building2Filled, resource: "suppliers" },
  { href: "/facilities", label: "Facilities", icon: WarehouseFilled, resource: "facilities" },
  { href: "/catalog", label: "Catalog", icon: ImagesFilled, resource: "catalog" },
];

const COLLAPSE_KEY = "consl.nav.production.collapsed";

function isActive(item: NavItem, pathname: string): boolean {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}

/** A hairline that carries a section label in the middle, like the header's dividers. The
 *  Production one also collapses its group — disabled while you're on one of its pages, since
 *  collapsing then would hide the tab you're looking at. */
function SectionHeader({
  label,
  collapsible = false,
  collapsed = false,
  disabled = false,
  onToggle,
}: {
  label: string;
  collapsible?: boolean;
  collapsed?: boolean;
  disabled?: boolean;
  onToggle?: () => void;
}) {
  const text = <span className="text-[10.5px] font-semibold uppercase tracking-wider">{label}</span>;
  return (
    <div className="flex items-center gap-2 px-1 pb-1.5 pt-3 first:pt-1">
      <div aria-hidden className="h-px flex-1 bg-border" />
      {collapsible ? (
        <button
          type="button"
          onClick={onToggle}
          disabled={disabled}
          aria-expanded={!collapsed}
          title={disabled ? "Open a page outside Production to collapse it" : collapsed ? "Expand" : "Collapse"}
          className={`flex items-center gap-1 rounded text-muted transition-colors ${
            disabled ? "cursor-default opacity-60" : "hover:text-ink-soft"
          }`}
        >
          {text}
          <ChevronDown size={13} className={`transition-transform ${collapsed ? "-rotate-90" : ""}`} />
        </button>
      ) : (
        <span className="text-muted">{text}</span>
      )}
      <div aria-hidden className="h-px flex-1 bg-border" />
    </div>
  );
}

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
  const analytics = ANALYTICS_NAV.filter((item) => canView(item.resource));
  const production = PRODUCTION_NAV.filter((item) => canView(item.resource));

  // Whether the page you're on lives in the Production group — the group can only be collapsed when
  // it doesn't, so collapsing never hides the tab you're currently viewing.
  const productionActive = production.some((item) => isActive(item, pathname));

  // Persisted across reloads; starts expanded. Read after mount to avoid a server/client mismatch.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
  }, []);
  function toggleCollapsed() {
    if (productionActive) return; // guarded — the chevron is disabled in this state
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
  }
  const showProduction = !collapsed || productionActive;

  const renderLink = (item: NavItem) => {
    const active = isActive(item, pathname);
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
  };

  return (
    <aside className="flex h-full w-[230px] shrink-0 flex-col overflow-y-auto bg-sidebar">
      {/* Theme switch sits where a sidebar search would — a full-width control, not a pill. */}
      <div className="px-3 pb-2.5 pt-3">
        <ThemeToggle />
      </div>

      <nav className="flex-1 px-3 py-2">
        {/* Analytics — Orders and the profit tracking to come. Always visible, above Production. */}
        {analytics.length > 0 && (
          <>
            <SectionHeader label="Analytics" />
            {analytics.map(renderLink)}
          </>
        )}

        {/* Production — the operational tabs, collapsible as one group (unless you're inside it). */}
        {production.length > 0 && (
          <>
            <SectionHeader
              label="Production"
              collapsible
              collapsed={collapsed}
              disabled={productionActive}
              onToggle={toggleCollapsed}
            />
            {showProduction && production.map(renderLink)}
          </>
        )}
      </nav>

      {/* Integrations sleeve: its own little landing above the footer, split off by a hairline. */}
      {canView("settings") && (
        <>
          <div aria-hidden className="mx-3 h-px bg-border" />
          <div className="px-3 py-2">
            <Link
              href="/settings/integrations"
              onClick={onNavigate}
              className={`flex items-center gap-3 rounded-lg px-3 py-1.5 text-[13.5px] font-medium transition-colors ${
                pathname.startsWith("/settings/integrations")
                  ? "bg-nav-active text-ink"
                  : "text-muted hover:bg-surface-2 hover:text-ink-soft"
              }`}
            >
              <Plug size={19} className={pathname.startsWith("/settings/integrations") ? "text-ink" : "text-muted"} />
              Integrations
            </Link>
          </div>
        </>
      )}

      <div className="flex items-center justify-between px-4 pb-4 pt-2">
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
