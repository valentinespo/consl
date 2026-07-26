"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import Image from "next/image";
import { Menu, X } from "lucide-react";
import { Sidebar } from "@/components/Sidebar";
import { CurrencyProvider } from "@/components/CurrencyProvider";
import { AppLogo } from "@/components/AppLogo";
import type { MyOrg } from "@/lib/orgs";

/** App chrome: fixed sidebar on desktop, slide-in drawer + top bar on mobile. Auth screens render bare. */
export function AppShell({
  children,
  orgName,
  orgs = [],
  currencySymbol = "$",
  locale = "en-US",
  currencyCode = "USD",
}: {
  children: React.ReactNode;
  orgName?: string | null;
  orgs?: MyOrg[];
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
    <div className="lg:flex">
      {/* Desktop sidebar */}
      <div className="hidden lg:sticky lg:top-0 lg:block lg:h-screen lg:shrink-0">
        <Sidebar orgName={orgName} orgs={orgs} />
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute inset-y-0 left-0 h-full shadow-xl">
            <Sidebar orgName={orgName} orgs={orgs} onNavigate={() => setOpen(false)} />
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

      {/* Content column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-surface/95 px-4 py-2.5 backdrop-blur lg:hidden">
          <button onClick={() => setOpen(true)} aria-label="Open menu" className="-ml-1 rounded-lg p-1.5 text-ink-soft hover:bg-surface-2">
            <Menu size={22} />
          </button>
          <AppLogo />
          {orgName && <span className="truncate text-[13px] text-muted">{orgName}</span>}
        </header>

        <main className="flex-1 lg:h-screen lg:overflow-y-auto">
          <div className="mx-auto max-w-[1180px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
        </main>
      </div>
    </div>
    </CurrencyProvider>
  );
}
