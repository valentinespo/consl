import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Only the auth screens are public; everything else requires a signed-in user.
const isPublic = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);

const enforced = clerkMiddleware(async (auth, req) => {
  if (!isPublic(req)) await auth.protect();
});

// Local-dev escape hatch: skip Clerk so the app can be run without signing in. Gated on an
// explicit opt-in rather than NODE_ENV alone — a preview box or a wrong start command must not
// be able to turn authentication off by accident.
const devBypass = process.env.NODE_ENV === "development" && process.env.ALLOW_DEV_AUTH_BYPASS === "1";

export default devBypass ? () => NextResponse.next() : enforced;

export const config = {
  matcher: [
    // Run on every route except Next internals and static assets. `/media` is deliberately NOT
    // excluded: it serves user-uploaded documents (invoices, BOLs, COAs) and must require a
    // signed-in user, with the route handler additionally checking org ownership.
    "/((?!_next|uploads|favicon.ico|[^?]*\\.(?:png|jpg|jpeg|svg|webp|gif|ico|avif|css|js|map|woff2?|ttf)).*)",
    "/(api|trpc)(.*)",
  ],
};
