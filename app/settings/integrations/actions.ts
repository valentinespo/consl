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
      data: { status: "revoked", refreshTokenEnc: null, accessTokenEnc: null, accessTokenExpiresAt: null, lastError: null },
    });
    if (provider === "meta_ads") await forgetMetaAdAccounts(gate.orgId);
    revalidatePath("/settings/integrations");
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not disconnect." };
  }
}

/** Stop importing one linked Meta ad account and take its spend off the books. Owner-only. */
export async function removeMetaAdAccount(accountId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const gate = await requireOwner();
  if (!gate.ok) return { ok: false, error: gate.error };
  try {
    await forgetMetaAdAccounts(gate.orgId, [accountId]);
    revalidatePath("/settings/integrations");
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not remove the ad account." };
  }
}

/**
 * Meta Ads leaves nothing behind: the linked accounts (all, or the ones named) go together with
 * their daily spend rows, so the P&L only ever shows accounts the company chose to keep.
 */
async function forgetMetaAdAccounts(orgId: string, accountIds?: string[]) {
  const accounts = await prismaBase.metaAdAccount.findMany({
    where: { orgId, ...(accountIds ? { accountId: { in: accountIds } } : {}) },
    select: { id: true, accountId: true },
  });
  const spend = accountIds
    ? accounts.length
      ? { orgId, OR: accounts.map((a) => ({ txId: { startsWith: `meta:${a.accountId}:` } })) }
      : null
    : { orgId, txId: { startsWith: "meta:" } };
  await prismaBase.$transaction([
    ...(spend ? [prismaBase.financeEvent.deleteMany({ where: spend })] : []),
    prismaBase.metaAdAccount.deleteMany({ where: { id: { in: accounts.map((a) => a.id) } } }),
    ...(accountIds ? [] : [prismaBase.settings.updateMany({ where: { orgId }, data: { metaAdsSyncedThrough: null, metaAdsSince: null } })]),
  ]);
}
