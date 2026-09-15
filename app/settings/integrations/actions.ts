"use server";

import { revalidatePath } from "next/cache";
import { prismaBase } from "@/lib/prisma-base";
import { requireOwner } from "@/lib/membership";
import type { Provider } from "@/lib/integrations";

/**
 * Disconnect a connection: clear the stored token and mark it revoked. Owner-only. Everything it
 * brought stays on the books — orders, money rows, facilities, mappings, sync markers — so a
 * reconnect simply resumes from where the imports stopped. Meta's linked ad accounts lose their
 * tokens the same way and keep their spend; `disconnectIntegrationAndWipe` is the one that
 * removes it all.
 */
export async function disconnectIntegration(provider: Provider): Promise<{ ok: true } | { ok: false; error: string }> {
  const gate = await requireOwner();
  if (!gate.ok) return { ok: false, error: gate.error };
  try {
    await prismaBase.integration.updateMany({
      where: { orgId: gate.orgId, provider },
      data: { status: "revoked", refreshTokenEnc: null, accessTokenEnc: null, accessTokenExpiresAt: null, lastError: null },
    });
    if (provider === "meta_ads") {
      await prismaBase.metaAdAccount.updateMany({ where: { orgId: gate.orgId }, data: { status: "revoked", accessTokenEnc: null } });
    }
    revalidatePath("/settings/integrations");
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not disconnect." };
  }
}

/** Disconnect Meta Ads AND wipe what it brought: the linked ad accounts, every day of their spend,
 *  the markers. Owner-only, Meta only — a sales channel's history is never wiped from here. */
export async function disconnectIntegrationAndWipe(provider: Provider): Promise<{ ok: true } | { ok: false; error: string }> {
  const gate = await requireOwner();
  if (!gate.ok) return { ok: false, error: gate.error };
  if (provider !== "meta_ads") return { ok: false, error: "Only Meta Ads can be wiped on disconnect." };
  try {
    await prismaBase.integration.updateMany({
      where: { orgId: gate.orgId, provider },
      data: { status: "revoked", refreshTokenEnc: null, accessTokenEnc: null, accessTokenExpiresAt: null, lastError: null },
    });
    await forgetMetaAdAccounts(gate.orgId);
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
 * Forget Meta ad accounts (all, or the ones named) together with their daily spend rows and, for
 * all, the markers — what "remove this ad account" and "disconnect and wipe" do, so the P&L only
 * ever shows spend the company chose to keep.
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
