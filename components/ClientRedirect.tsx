"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * A redirect carried out by the browser's router once the page has arrived. Rendered by the
 * server in place of a page during a CLIENT-SIDE navigation, where a server `redirect()` from a
 * layout makes Next's router throw "Rendered more hooks than during the previous render" and
 * strand the visitor on the built-in error page (Next 16.2, seen 2026-09-16). Covers the screen
 * so nothing behind it shows for the moment before the hop.
 */
export function ClientRedirect({ to }: { to: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(to);
  }, [router, to]);
  return <div aria-hidden className="fixed inset-0 z-[1000] bg-bg" />;
}
