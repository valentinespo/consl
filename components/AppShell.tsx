"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { X } from "@/components/icons";
import { Sidebar } from "@/components/Sidebar";
import { AppHeader } from "@/components/AppHeader";
import { CurrencyProvider } from "@/components/CurrencyProvider";
import { AccessProvider } from "@/components/AccessProvider";
import type { MyOrg } from "@/lib/orgs";

/**
 * App chrome, Shopify-style: a midnight-navy header across the top, and below it one rounded
 * "page" holding the sidebar and content. The rounding is done by clipping the page frame over
 * the navy root background, so the header colour shows through the two top corners.
 * Auth screens render bare.
 */
export function AppShell({
  children,
  orgName,
  orgs = [],
  allowed = null,
  caps = null,
  currencySymbol = "$",
  locale = "en-US",
  currencyCode = "USD",
}: {
  children: React.ReactNode;
  orgName?: string | null;
  orgs?: MyOrg[];
  allowed?: string[] | null;
  caps?: Record<string, string[]> | null;
  currencySymbol?: string;
  locale?: string;
  currencyCode?: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Auth and onboarding screens render bare — there's no company yet to put in the chrome.
  const BARE = ["/sign-in", "/sign-up", "/welcome", "/join"];
  if (BARE.some((p) => pathname.startsWith(p))) return <>{children}</>;

  return (
    <CurrencyProvider symbol={currencySymbol} locale={locale} code={currencyCode}>
      <AccessProvider caps={caps}>
      <div className="flex h-dvh flex-col bg-header">
        <AppHeader onMenu={() => setOpen(true)} />

        {/* Mobile drawer */}
        {open && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} aria-hidden />
            <div className="absolute inset-y-0 left-0 h-full shadow-xl">
              <Sidebar orgName={orgName} orgs={orgs} allowed={allowed} onNavigate={() => setOpen(false)} />
              <button
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="absolute right-3 top-4 rounded-lg p-1 text-muted hover:bg-surface-2 hover:text-ink-soft"
              >
                <X size={18} />
              </button>
            </div>
          </div>
        )}

        {/* The page frame. rounded + overflow-hidden lets the navy show through the corners. */}
        <div className="flex min-h-0 flex-1 overflow-hidden rounded-t-[14px]">
          <div className="hidden h-full shrink-0 lg:block">
            <Sidebar orgName={orgName} orgs={orgs} allowed={allowed} />
          </div>
          <main className="min-w-0 flex-1 overflow-y-auto bg-bg">
            <div className="mx-auto max-w-[1180px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
          </main>
        </div>
      </div>
      </AccessProvider>
    </CurrencyProvider>
  );
}
