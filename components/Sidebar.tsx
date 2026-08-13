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
  SalesProfitFilled,
  PnlFilled,
  ChevronDown,
  Plug,
  Settings,
  type LucideIcon,
} from "@/components/icons";
import { ThemeToggle } from "@/components/ThemeToggle";

type NavItem = { href: string; label: string; icon: LucideIcon; exact?: boolean; resource: string };

// Finances — sales, profit and the P&L built on the orders underneath. Collapsible as a group.
const FINANCES_NAV: NavItem[] = [
  { href: "/sales-profit", label: "Sales & Profit", icon: SalesProfitFilled, resource: "dashboard" },
  { href: "/pnl", label: "P&L", icon: PnlFilled, resource: "dashboard" },
  { href: "/orders", label: "Orders", icon: OrdersFilled, resource: "dashboard" },
];

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

const COLLAPSE_KEYS = { finances: "consl.nav.finances.collapsed", production: "consl.nav.production.collapsed" };

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
          title={disabled ? `Open a page outside ${label} to collapse it` : collapsed ? "Expand" : "Collapse"}
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
  const finances = FINANCES_NAV.filter((item) => canView(item.resource));
  const production = PRODUCTION_NAV.filter((item) => canView(item.resource));

  // Whether the page you're on lives in each group — a group can only be collapsed when it
  // doesn't, so collapsing never hides the tab you're currently viewing.
  const financesActive = finances.some((item) => isActive(item, pathname));
  const productionActive = production.some((item) => isActive(item, pathname));

  // Persisted across reloads; start expanded. Read after mount to avoid a server/client mismatch.
  const [collapsed, setCollapsed] = useState({ finances: false, production: false });
  useEffect(() => {
    setCollapsed({
      finances: localStorage.getItem(COLLAPSE_KEYS.finances) === "1",
      production: localStorage.getItem(COLLAPSE_KEYS.production) === "1",
    });
  }, []);
  function toggleCollapsed(group: "finances" | "production", active: boolean) {
    if (active) return; // guarded — the chevron is disabled in this state
    setCollapsed((prev) => {
      const next = { ...prev, [group]: !prev[group] };
      localStorage.setItem(COLLAPSE_KEYS[group], next[group] ? "1" : "0");
      return next;
    });
  }
  const showFinances = !collapsed.finances || financesActive;
  const showProduction = !collapsed.production || productionActive;

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
        {/* Finances — Sales & Profit, P&L and Orders. Collapsible, above Production. */}
        {finances.length > 0 && (
          <>
            <SectionHeader
              label="Finances"
              collapsible
              collapsed={collapsed.finances}
              disabled={financesActive}
              onToggle={() => toggleCollapsed("finances", financesActive)}
            />
            {showFinances && finances.map(renderLink)}
          </>
        )}

        {/* Production — the operational tabs, collapsible as one group (unless you're inside it). */}
        {production.length > 0 && (
          <>
            <SectionHeader
              label="Production"
              collapsible
              collapsed={collapsed.production}
              disabled={productionActive}
              onToggle={() => toggleCollapsed("production", productionActive)}
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
