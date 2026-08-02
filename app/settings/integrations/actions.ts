"use server";

import { revalidatePath } from "next/cache";
import { prismaBase } from "@/lib/prisma-base";
import { requireOwner } from "@/lib/membership";
import type { Provider } from "@/lib/integrations";

/**
 * Disconnect a sales channel: clear the stored token and mark the connection revoked. Owner-only.
 * The channel facilities are intentionally LEFT in place — they carry movement history — matching
 * the "locked facility" model; a future step decides whether to unlock or archive them.
 */
export async function disconnectIntegration(provider: Provider): Promise<{ ok: true } | { ok: false; error: string }> {
  const gate = await requireOwner();
  if (!gate.ok) return { ok: false, error: gate.error };
  try {
    await prismaBase.integration.updateMany({
      where: { orgId: gate.orgId, provider },
      data: { status: "revoked", refreshTokenEnc: null, lastError: null },
    });
    revalidatePath("/settings/integrations");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not disconnect." };
  }
}
