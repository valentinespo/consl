import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Only the auth screens are public; everything else requires a signed-in user.
const isPublic = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);

const enforced = clerkMiddleware(async (auth, req) => {
  if (!isPublic(req)) await auth.protect();
});

// Local-dev only: skip Clerk entirely so the app can be run without signing in. `next dev` sets
// NODE_ENV=development; the deployed app runs `next start` (production), where Clerk is always
// enforced — so login is mandatory on the live site and this branch is dead code there.
export default process.env.NODE_ENV === "development"
  ? () => NextResponse.next()
  : enforced;

export const config = {
  matcher: [
    // Run on every route except Next internals, static assets, and served media/uploads.
    "/((?!_next|media|uploads|favicon.ico|[^?]*\\.(?:png|jpg|jpeg|svg|webp|gif|ico|avif|css|js|map|woff2?|ttf)).*)",
    "/(api|trpc)(.*)",
  ],
};
