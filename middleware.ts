import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Auth screens plus the public marketing pages; everything else requires a signed-in user. The
// Shopify compliance webhook is server-to-server (no session) — it authenticates with its own HMAC.
const isPublic = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/home",
  "/privacy",
  "/terms",
  "/api/integrations/shopify/compliance",
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

const enforced = clerkMiddleware(async (auth, req) => {
  // A signed-out visitor to the root gets the marketing site; signed-in users keep the dashboard.
  // Redirect rather than rewrite: the app shell decides bare-vs-chrome from the client pathname,
  // which under a rewrite would still read "/" and wrap the landing page in app chrome.
  if (req.nextUrl.pathname === "/") {
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
  // Pass the path through as a request header so the root layout can tell whether the user is
  // already on the onboarding pages before deciding to redirect them there.
  const headers = new Headers(req.headers);
  headers.set("x-pathname", req.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
});

// Local-dev escape hatch: skip Clerk so the app can be run without signing in. Gated on an
// explicit opt-in rather than NODE_ENV alone — a preview box or a wrong start command must not
// be able to turn authentication off by accident.
const devBypass = process.env.NODE_ENV === "development" && process.env.ALLOW_DEV_AUTH_BYPASS === "1";

export default devBypass
  ? (req: Request & { nextUrl: URL }) => {
      const legacy = rewriteLegacyUploads(req);
      return legacy ? NextResponse.rewrite(legacy) : NextResponse.next();
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
