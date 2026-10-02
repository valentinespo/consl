"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/membership";
import { XeroSaveError, discardXeroDraft, publishXeroSetup, saveXeroDraft } from "@/lib/xero-setup";
import type { XeroSetupState, XeroTarget } from "@/lib/xero-setup-shared";

// Xero's and consl's own messages read fine; a database hiccup doesn't.
const readable = (e: unknown, fallback: string) => {
  const msg = e instanceof Error ? e.message : "";
  return !msg || /prisma|invocation|timed out/i.test(msg) ? fallback : msg;
};

/** Keep the setup as a draft in consl. Nothing reaches Xero. */
export async function saveXeroDraftAction(state: XeroSetupState): Promise<{ ok: true; draftSavedAt: string } | { ok: false; error: string }> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return gate;
  try {
    // The screen already shows what was saved; a reload reads the draft (the page is dynamic).
    const r = await saveXeroDraft(gate.orgId, state);
    return { ok: true, ...r };
  } catch (e) {
    console.error(`[xero] saving the setup draft for ${gate.orgId} failed:`, (e as Error).message);
    return { ok: false, error: readable(e, "Couldn't save the draft. Try again.") };
  }
}

/** Throw the saved draft away: the setup goes back to what's published. */
export async function discardXeroDraftAction(): Promise<{ ok: true } | { ok: false; error: string }> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return gate;
  try {
    await discardXeroDraft(gate.orgId);
    return { ok: true };
  } catch (e) {
    console.error(`[xero] discarding the setup draft for ${gate.orgId} failed:`, (e as Error).message);
    return { ok: false, error: readable(e, "Couldn't discard the draft. Try again.") };
  }
}

/**
 * Publish the setup to Xero: creates the new accounts there, then stores the setup the monthly
 * journals use. A failed publish still hands back the accounts it had settled (created), so the
 * screen shows them.
 */
export async function publishXeroSetupAction(
  state: XeroSetupState,
): Promise<
  | { ok: true; created: { code: string; name: string }[]; targets: Record<string, XeroTarget> }
  | { ok: false; error: string; settled?: Record<string, XeroTarget> }
> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return gate;
  try {
    const r = await publishXeroSetup(gate.orgId, state);
    revalidatePath("/pnl/xero");
    revalidatePath("/pnl");
    return { ok: true, ...r };
  } catch (e) {
    console.error(`[xero] publishing the export setup for ${gate.orgId} failed:`, (e as Error).message);
    const error = readable(e, "Couldn't publish the setup. Try again.");
    return e instanceof XeroSaveError && Object.keys(e.settled).length ? { ok: false, error, settled: e.settled } : { ok: false, error };
  }
}
