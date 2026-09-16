import "server-only";
import { prismaBase } from "@/lib/prisma-base";

/** A URL-safe slug from the company name, with a numeric suffix if it's taken. */
export async function uniqueOrgSlug(name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "company";
  let slug = base;
  let n = 2;
  while (await prismaBase.organization.findUnique({ where: { slug }, select: { id: true } })) {
    slug = `${base}-${n++}`;
  }
  return slug;
}

/** True when this person already owns a company that is never gated (Herbl, the demo company,
 *  internal accounts). Any further company they create inherits that; a new customer's first
 *  company does not and waits for its trial. */
export async function ownsExemptCompany(clerkUserId: string): Promise<boolean> {
  const n = await prismaBase.membership.count({
    where: { clerkUserId, organization: { billingExempt: true, deactivatedAt: null } },
  });
  return n > 0;
}

export type NewCompanyInput = {
  userId: string;
  name: string;
  currencyCode?: string;
  currencySymbol?: string;
  locale?: string;
  email?: string | null;
  phone?: string | null;
};

/**
 * Create a company and make the signed-in user its owner. Both rows are written in one
 * transaction — an Organization with no membership is unreachable by anyone, and a Membership
 * without its org is meaningless. Shared by the welcome form and the early-access flow.
 */
export async function createCompanyForUser(input: NewCompanyInput): Promise<{ id: string; slug: string }> {
  const slug = await uniqueOrgSlug(input.name);
  const billingExempt = await ownsExemptCompany(input.userId);
  return prismaBase.$transaction(async (tx) => {
    const created = await tx.organization.create({
      data: {
        name: input.name,
        slug,
        currencyCode: input.currencyCode ?? "USD",
        currencySymbol: input.currencySymbol ?? "$",
        locale: input.locale ?? "en-US",
        email: input.email ?? undefined,
        phone: input.phone ?? undefined,
        billingExempt,
      },
    });
    await tx.membership.create({ data: { clerkUserId: input.userId, orgId: created.id, role: "owner" } });
    return { id: created.id, slug };
  });
}
