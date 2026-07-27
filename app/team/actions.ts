"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { currentUserId } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { prismaBase } from "@/lib/prisma-base";
import { requireOwner } from "@/lib/membership";
import { setActiveOrgCookie, clearActiveOrgCookie } from "@/lib/active-org";

const INVITE_DAYS = 14;

/** Create an invite link for someone to join the current company. Owners only. */
export async function createInvite(input: { email: string; role: "owner" | "member" }) {
  const gate = await requireOwner();
  if (!gate.ok) return { ok: false as const, error: gate.error };

  const email = input.email.trim().toLowerCase().slice(0, 200);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false as const, error: "That doesn't look like an email address." };
  }
  const role = input.role === "owner" ? "owner" : "member";

  // Don't hand out a second link to someone who already has an open one.
  const open = await prisma.invite.findFirst({ where: { email, acceptedAt: null, expiresAt: { gt: new Date() } } });
  if (open) return { ok: true as const, token: open.token, reused: true };

  const token = randomBytes(24).toString("base64url");
  const invite = await prisma.invite.create({
    data: {
      email,
      role,
      token,
      invitedBy: gate.userId,
      expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
    },
  });
  revalidatePath("/settings/company");
  return { ok: true as const, token: invite.token };
}

/** Withdraw an invite that hasn't been used. Owners only. */
export async function revokeInvite(id: string) {
  const gate = await requireOwner();
  if (!gate.ok) return { ok: false as const, error: gate.error };
  // Scoped client: an id from another company simply isn't found.
  const invite = await prisma.invite.findFirst({ where: { id, acceptedAt: null }, select: { id: true } });
  if (!invite) return { ok: false as const, error: "That invite is no longer pending." };
  await prisma.invite.delete({ where: { id: invite.id } });
  revalidatePath("/settings/company");
  return { ok: true as const };
}

/** Remove someone from the company. Owners only, and never the last owner. */
export async function removeMember(clerkUserId: string) {
  const gate = await requireOwner();
  if (!gate.ok) return { ok: false as const, error: gate.error };

  const target = await prismaBase.membership.findFirst({
    where: { clerkUserId, orgId: gate.orgId },
    select: { id: true, role: true },
  });
  if (!target) return { ok: false as const, error: "They're not a member of this company." };

  if (target.role === "owner") {
    const owners = await prismaBase.membership.count({ where: { orgId: gate.orgId, role: "owner" } });
    if (owners <= 1) {
      return { ok: false as const, error: "This is the only owner — make someone else an owner first." };
    }
  }
  await prismaBase.membership.delete({ where: { id: target.id } });
  revalidatePath("/settings/company");
  return { ok: true as const };
}

/**
 * Accept an invite and join its company.
 *
 * Deliberately unscoped: the caller has no organization yet, so the tenant client would refuse
 * every query. The random token in the link is the credential. The invite's email is shown to the
 * owner for their own reference but is not enforced here — Clerk owns identity, and requiring the
 * addresses to match would lock out anyone who signs up with an alias. Joining adds a company; it
 * never replaces one they already belong to.
 */
export async function acceptInvite(token: string) {
  const userId = await currentUserId();
  if (!userId) return { ok: false as const, error: "Sign in first, then open the link again." };

  const invite = await prismaBase.invite.findUnique({ where: { token } });
  if (!invite || !invite.orgId) return { ok: false as const, error: "This invite link isn't valid." };
  const orgId = invite.orgId;
  if (invite.acceptedAt) return { ok: false as const, error: "This invite has already been used." };
  if (invite.expiresAt < new Date()) return { ok: false as const, error: "This invite has expired. Ask for a new one." };

  // Belonging to several companies is normal — only re-joining the same one is a no-op.
  const already = await prismaBase.membership.findFirst({
    where: { clerkUserId: userId, orgId },
    select: { id: true },
  });
  if (already) {
    await setActiveOrgCookie(orgId);
    return { ok: true as const, orgId };
  }

  await prismaBase.$transaction(async (tx) => {
    await tx.membership.create({ data: { clerkUserId: userId, orgId, role: invite.role } });
    await tx.invite.update({ where: { id: invite.id }, data: { acceptedAt: new Date(), acceptedBy: userId } });
  });

  // Land in the company they just joined.
  await setActiveOrgCookie(orgId);
  revalidatePath("/", "layout");
  return { ok: true as const, orgId };
}

/**
 * Delete the whole company. Owners only.
 *
 * This is a soft delete: the company goes dark immediately (hidden from the switcher, unreachable),
 * but its data is kept for a grace period so a customer who changes their mind — or comes back —
 * can be restored. The scheduler purges anything past the grace window for good (cascading across
 * every tenant table). The name is typed and confirmed twice in the UI and re-checked here.
 */
export async function deleteOrganization(confirmName: string) {
  const gate = await requireOwner();
  if (!gate.ok) return { ok: false as const, error: gate.error };

  const org = await prismaBase.organization.findUnique({
    where: { id: gate.orgId },
    select: { id: true, name: true },
  });
  if (!org) return { ok: false as const, error: "Company not found." };

  if (confirmName.trim() !== org.name.trim()) {
    return { ok: false as const, error: "That doesn't match the company name." };
  }

  // Mark it deactivated rather than dropping rows. Access resolution and the switcher both filter
  // these out, so it disappears at once; the purge job finishes the job after the grace period.
  await prismaBase.organization.update({ where: { id: org.id }, data: { deactivatedAt: new Date() } });

  // Drop the active-company cookie so the next request resolves a company they still belong to.
  await clearActiveOrgCookie();

  revalidatePath("/", "layout");
  return { ok: true as const };
}
