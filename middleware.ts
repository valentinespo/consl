import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Only the auth screens are public; everything else requires a signed-in user.
const isPublic = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);

const enforced = clerkMiddleware(async (auth, req) => {
  if (!isPublic(req)) await auth.protect();
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

export default devBypass ? () => NextResponse.next() : enforced;

export const config = {
  matcher: [
    // Run on every route except Next internals and static assets.
    "/((?!_next|uploads|favicon.ico|[^?]*\\.(?:png|jpg|jpeg|svg|webp|gif|ico|avif|css|js|map|woff2?|ttf)).*)",
    "/(api|trpc)(.*)",
    // /media serves user-uploaded files — invoices, BOLs, product photos, company marks — and
    // must require a signed-in user so the route can check the file belongs to their company.
    // It needs its own entry: the pattern above skips anything ending in an image extension, so
    // an uploaded .jpg or .png would otherwise reach the route with no session attached, be
    // judged "not yours", and 404 as a broken image. PDFs were unaffected, which is why only
    // pictures broke.
    "/media/:path*",
  ],
};
