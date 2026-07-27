"use client";

import { createContext, useContext, useMemo } from "react";
import type { Action, Resource } from "@/lib/permissions";

/**
 * Client-side mirror of the signed-in member's grants, so controls a member can't use aren't shown.
 * This is convenience, not security — every mutation is still checked on the server. A null map
 * means "don't restrict" (owner, or a resolution hiccup): fail open in the UI, never hiding an
 * owner's buttons, because the server is the real gate.
 */
type Caps = Record<string, string[]> | null;

const AccessContext = createContext<Caps>(null);

export function AccessProvider({ caps, children }: { caps: Caps; children: React.ReactNode }) {
  const value = useMemo(() => caps, [caps]);
  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

/** True when the member may take `action` on `resource` (or when access isn't being restricted). */
export function useCan(resource: Resource, action: Action): boolean {
  const caps = useContext(AccessContext);
  if (caps === null) return true;
  return (caps[resource] ?? []).includes(action);
}
