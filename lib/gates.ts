/**
 * Which paths are reachable regardless of company state: auth screens, the marketing pages, the
 * early-access flow and the waiting screen. Shared by the root template (which enforces the
 * gates) and the root layout (which only loads data). Plain module: no "server-only".
 */
export const NO_ORG_OK = ["/sign-in", "/sign-up", "/welcome", "/join", "/home", "/privacy", "/terms", "/apply", "/pre-onboarding"];

export function isOpenPath(pathname: string): boolean {
  return NO_ORG_OK.some((p) => pathname.startsWith(p));
}
