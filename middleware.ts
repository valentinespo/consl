import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Only the auth screens are public; everything else requires a signed-in user.
const isPublic = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublic(req)) await auth.protect();
});

export const config = {
  matcher: [
    // Run on every route except Next internals, static assets, and served media/uploads.
    "/((?!_next|media|uploads|favicon.ico|[^?]*\\.(?:png|jpg|jpeg|svg|webp|gif|ico|avif|css|js|map|woff2?|ttf)).*)",
    "/(api|trpc)(.*)",
  ],
};
