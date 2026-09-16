import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ClientRedirect } from "@/components/ClientRedirect";

/**
 * Redirect from a gate in a way that survives every kind of request.
 *
 * A full page load gets a real HTTP redirect — no flash, nothing rendered. Anything Next's
 * router fetches itself — a client-side navigation (`RSC` header) or a server action (`Next-Action`
 * header, which re-renders the page tree in its response) — instead receives a tiny client
 * component that performs the hop. The reason (2026-09-16): a server `redirect()` thrown during
 * one of those renders is turned into a full-page navigation by Next's router; racing a pending
 * client transition, that throws "Rendered more hooks than during the previous render" and
 * strands the visitor on the built-in error page. The notifications bell fires a server action
 * the moment the app chrome mounts, so any gated arrival used to hit exactly that. Callers
 * `return gateRedirect(...)` from a layout or page in place of their children.
 */
export async function gateRedirect(to: string): Promise<React.ReactElement> {
  const h = await headers();
  const routerRequest = h.get("rsc") === "1" || h.get("next-router-state-tree") !== null || h.get("next-action") !== null;
  if (!routerRequest) redirect(to);
  return <ClientRedirect to={to} />;
}
