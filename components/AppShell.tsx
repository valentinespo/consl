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
 * App chrome: the top strip and the sidebar share one gray surface, and the open page floats to
 * the right as a white panel with curved top corners — the chrome gray shows through the corner
 * radius, which is what sells the "page on a desk" read. Auth screens render bare.
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
  const BARE = ["/sign-in", "/sign-up", "/welcome", "/join", "/home", "/privacy", "/terms"];
  if (BARE.some((p) => pathname.startsWith(p))) return <>{children}</>;

  return (
    <CurrencyProvider symbol={currencySymbol} locale={locale} code={currencyCode}>
      <AccessProvider caps={caps}>
      <div className="relative flex h-dvh flex-col bg-header">
        {/* The header floats over the page as a frosted overlay — content scrolling in the panel
            below passes beneath it and blurs. Over the static sidebar it reads as solid gray. */}
        <div className="absolute inset-x-0 top-0 z-30">
          {/* The frosted bar's backdrop-filter makes it a sealed stacking context, so its popups
              (company menu, notifications) can't out-z later siblings on their own — lift the
              whole bar above the decorative frame edge below. */}
          <div className="relative z-10">
            <AppHeader onMenu={() => setOpen(true)} orgs={orgs} />
          </div>
          {/* The page frame's top edge, persistent beneath the frosted bar: two inverted-radius
              gray shoulders recreate the curved corners, joined by the frame's hairline. Content
              scrolls under the frost and disappears beneath this edge — the frame never moves. */}
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-14">
            <span
              className="absolute left-0 top-0 h-3.5 w-3.5 lg:left-[230px]"
              style={{ background: "radial-gradient(circle at 100% 100%, transparent 13px, var(--color-border) 13px 14px, var(--color-header) 14px)" }}
            />
            <span
              className="absolute right-0 top-0 h-3.5 w-3.5"
              style={{ background: "radial-gradient(circle at 0% 100%, transparent 13px, var(--color-border) 13px 14px, var(--color-header) 14px)" }}
            />
            <span className="absolute left-3.5 right-3.5 top-0 h-px bg-border lg:left-[244px]" />
          </div>
        </div>

        {/* Mobile drawer */}
        {open && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} aria-hidden />
            <div className="absolute inset-y-0 left-0 h-full shadow-xl">
              <Sidebar orgName={orgName} allowed={allowed} onNavigate={() => setOpen(false)} />
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

        <div className="flex min-h-0 flex-1">
          {/* Sidebar content starts below the header; the gray beneath the frosted bar is the
              same canvas, so the left half of the header still reads as one merged surface. */}
          <div className="hidden h-full shrink-0 pt-14 lg:block">
            <Sidebar orgName={orgName} allowed={allowed} />
          </div>
          {/* The open page: white, its own hairline edge, curved top corners over the gray. It
              reaches the top of the viewport, tucked under the frosted header — pt-14 keeps
              resting content clear of the bar, and scrolled content blurs beneath it. */}
          <main className="min-w-0 flex-1 overflow-y-auto rounded-t-[14px] border border-border bg-bg">
            {/* In-flow gray spacer, not padding: at rest it fills the band under the frosted bar
                with the chrome gray (so the header reads as one surface edge to edge, exactly the
                pre-blur look), and it scrolls away with the content so the blur takes over. */}
            <div aria-hidden className="h-14 bg-header" />
            <div className="mx-auto max-w-[1180px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
          </main>
        </div>
      </div>
      </AccessProvider>
    </CurrencyProvider>
  );
}
