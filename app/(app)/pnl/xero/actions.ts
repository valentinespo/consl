"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/membership";
import { XeroSaveError, saveXeroSetup, type XeroSetupInput } from "@/lib/xero-setup";
import type { XeroTarget } from "@/lib/xero-setup-shared";

/**
 * Save the Xero export setup: creates the new accounts in Xero, then stores the choices. A failed
 * save still hands back the rows it had settled (accounts it created), so the screen shows them.
 */
export async function saveXeroSetupAction(
  input: XeroSetupInput,
): Promise<
  | { ok: true; created: { code: string; name: string }[]; targets: Record<string, XeroTarget> }
  | { ok: false; error: string; settled?: Record<string, XeroTarget> }
> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return gate;
  try {
    const r = await saveXeroSetup(gate.orgId, input);
    revalidatePath("/pnl/xero");
    revalidatePath("/pnl");
    return { ok: true, ...r };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    console.error(`[xero] saving the export setup for ${gate.orgId} failed:`, msg);
    // Xero's and consl's own messages read fine; a database hiccup doesn't.
    const error = !msg || /prisma|invocation|timed out/i.test(msg) ? "Couldn't save the setup. Try again." : msg;
    return e instanceof XeroSaveError && Object.keys(e.settled).length ? { ok: false, error, settled: e.settled } : { ok: false, error };
  }
}
