import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, sha256hex } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return NextResponse.next(); // gate disabled (no password configured, e.g. local dev)

  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  if (cookie && cookie === (await sha256hex(pw))) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = req.nextUrl.pathname === "/" ? "" : `?from=${encodeURIComponent(req.nextUrl.pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except the login page, Next internals, and uploaded/static images.
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico|uploads|media|.*\\.(?:png|jpg|jpeg|svg|webp|gif|ico|avif)).*)"],
};
