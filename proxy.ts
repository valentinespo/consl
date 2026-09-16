import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";
import { gateDecision } from "@/lib/gate-decision";
import { ACTIVE_ORG_COOKIE } from "@/lib/active-org-cookie-name";
import { isSuperuserId } from "@/lib/superuser-ids";

// (Next 16: this file is the "proxy", the Node-runtime middleware — it may use the database.)
// Auth screens plus the public marketing pages; everything else requires a signed-in user. The
// Shopify compliance webhook and the order webhooks are server-to-server (no session) — each
// authenticates with its own HMAC inside the route.
const isPublic = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/home",
  "/apply(.*)",
  "/privacy",
  "/terms",
  "/api/integrations/shopify/compliance",
  "/api/webhooks/(.*)",
  // Shopify's install flow: an install that starts on Shopify's side runs with nobody signed in
  // (authorization first, sign-in after — Shopify's rule), so its start, its callback and the
  // "finish connecting" page must not bounce a signed-out visitor to sign-in.
  "/api/integrations/shopify/connect",
  "/api/integrations/shopify/callback",
  "/connect/shopify",
]);

// Legacy files used to sit in public/uploads and were served statically with no auth. They've been
// moved out of public/; this sends any surviving "/uploads/..." URL (still stored in old DB rows)
// through the authenticated, ownership-checked /media route instead. Runs in both branches below.
function rewriteLegacyUploads(req: Request & { nextUrl: URL }): URL | null {
  const { pathname } = req.nextUrl;
  if (!pathname.startsWith("/uploads/")) return null;
  const to = new URL(req.nextUrl);
  to.pathname = "/media/" + pathname.slice("/uploads/".length);
  return to;
}

// An install that starts on Shopify's side (the App Store listing's Install button, a development
// store's app page, the app opened from a store's admin) lands on the app URL with the store
// attached: "/?shop=x.myshopify.com&hmac=…". Shopify requires the app to start its authorization
// right away — before any sign-in — so this goes straight to the connect route, signed in or not;
// the callback parks the store's token until the person signs in or signs up.
function shopifyInstallTarget(req: Request & { nextUrl: URL }): string | null {
  const shop = (req.nextUrl.searchParams.get("shop") ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) return null;
  return `/api/integrations/shopify/connect?shop=${encodeURIComponent(shop)}`;
}

const enforced = clerkMiddleware(async (auth, req) => {
  // A signed-out visitor to the root gets the marketing site; signed-in users keep the dashboard.
  // Redirect rather than rewrite: the app shell decides bare-vs-chrome from the client pathname,
  // which under a rewrite would still read "/" and wrap the landing page in app chrome.
  if (req.nextUrl.pathname === "/") {
    const install = shopifyInstallTarget(req);
    if (install) {
      const url = req.nextUrl.clone();
      const [path, query] = install.split("?");
      url.pathname = path;
      url.search = `?${query}`;
      return NextResponse.redirect(url);
    }
    const { userId } = await auth();
    if (!userId) {
      const url = req.nextUrl.clone();
      url.pathname = "/home";
      return NextResponse.redirect(url);
    }
  }
  if (!isPublic(req)) await auth.protect();
  const legacy = rewriteLegacyUploads(req);
  if (legacy) return NextResponse.rewrite(legacy);
  // The product gate, decided here so the answer is a plain HTTP redirect before any render —
  // the one form of redirect Next's router handles cleanly on client-side navigation. See
  // lib/gate-decision.ts for the rules and for why this is not done in a layout.
  const gated = await gateForRequest(req, (await auth()).userId ?? null, false);
  if (gated) return gated;
  // Pass the path through as a request header so server code can tell which page it's on.
  const headers = new Headers(req.headers);
  headers.set("x-pathname", req.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
});

/** The gate's redirect response for this request, or null to let it through. Never throws: a
 *  database hiccup must not lock everyone out, so a failed decision lets the page's own checks
 *  (the route-group layout) take over. */
async function gateForRequest(req: NextRequest, userId: string | null, devBypass: boolean) {
  try {
    const to = await gateDecision({
      pathname: req.nextUrl.pathname,
      userId,
      cookieOrgId: req.cookies.get(ACTIVE_ORG_COOKIE)?.value ?? null,
      devBypass,
      superuser: isSuperuserId(userId),
    });
    if (!to) return null;
    const url = req.nextUrl.clone();
    url.pathname = to;
    url.search = "";
    return NextResponse.redirect(url);
  } catch {
    return null;
  }
}

// Local-dev escape hatch: skip Clerk so the app can be run without signing in. Gated on an
// explicit opt-in rather than NODE_ENV alone — a preview box or a wrong start command must not
// be able to turn authentication off by accident.
const devBypass = process.env.NODE_ENV === "development" && process.env.ALLOW_DEV_AUTH_BYPASS === "1";

export default devBypass
  ? async (req: NextRequest) => {
      const legacy = rewriteLegacyUploads(req);
      if (legacy) return NextResponse.rewrite(legacy);
      // Same gate as the enforced branch, resolving the company the way the bypass does.
      const gated = await gateForRequest(req, null, true);
      if (gated) return gated;
      // The layout reads x-pathname to know where it is (e.g. the onboarding gate deciding
      // whether to redirect). Without it, an un-onboarded org redirect-loops on /onboarding —
      // so the bypass branch must pass it through exactly like the enforced branch does.
      const headers = new Headers(req.headers);
      headers.set("x-pathname", req.nextUrl.pathname);
      return NextResponse.next({ request: { headers } });
    }
  : enforced;

export const config = {
  matcher: [
    // Run on every route except Next internals and static assets.
    "/((?!_next|favicon.ico|[^?]*\\.(?:png|jpg|jpeg|svg|webp|gif|ico|avif|css|js|map|woff2?|ttf)).*)",
    "/(api|trpc)(.*)",
    // Legacy upload URLs (any extension) must reach middleware to be rewritten to /media — the
    // pattern above skips image extensions, so give /uploads its own entry like /media has.
    "/uploads/:path*",
    // /media serves user-uploaded files — invoices, BOLs, product photos, company marks — and
    // must require a signed-in user so the route can check the file belongs to their company.
    // It needs its own entry: the pattern above skips anything ending in an image extension, so
    // an uploaded .jpg or .png would otherwise reach the route with no session attached, be
    // judged "not yours", and 404 as a broken image. PDFs were unaffected, which is why only
    // pictures broke.
    "/media/:path*",
  ],
};
