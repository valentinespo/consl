"use server";

import { revalidatePath } from "next/cache";
import { currentUserId } from "@/lib/current-user";
import { prismaBase } from "@/lib/prisma-base";
import { setActiveOrgCookie } from "@/lib/active-org";

/** A URL-safe slug from the company name, with a numeric suffix if it's taken. */
async function uniqueSlug(name: string): Promise<string> {
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

export type NewCompany = {
  name: string;
  currencyCode: string;
  currencySymbol: string;
  locale: string;
};

/**
 * Create a company for the signed-in user and make them its owner. A person can belong to several
 * — running more than one business, or being invited into a client's — so this is not limited to
 * their first.
 *
 * Uses the unscoped client throughout: the caller has no organization yet, so the tenant-scoped
 * client would refuse every query. Both rows are written in one transaction — an Organization
 * with no membership is unreachable by anyone, and a Membership without its org is meaningless.
 */
export async function createCompany(input: NewCompany) {
  const userId = await currentUserId();
  if (!userId) return { ok: false as const, error: "You need to be signed in." };

  const name = input.name.trim().slice(0, 120);
  if (!name) return { ok: false as const, error: "Give your company a name." };

  const currencyCode = /^[A-Za-z]{3}$/.test(input.currencyCode) ? input.currencyCode.toUpperCase() : "USD";
  const currencySymbol = input.currencySymbol.trim().slice(0, 4) || "$";
  // An invalid locale (the classic "de_DE" with an underscore) makes every number/date format
  // throw once stored, so validate here exactly as the settings page does rather than trust it.
  const localeIn = input.locale.trim().slice(0, 20);
  let locale = "en-US";
  try {
    if (localeIn && Intl.NumberFormat.supportedLocalesOf([localeIn]).length > 0) locale = localeIn;
  } catch {
    /* keep en-US */
  }
  const slug = await uniqueSlug(name);

  const org = await prismaBase.$transaction(async (tx) => {
    const created = await tx.organization.create({
      data: { name, slug, currencyCode, currencySymbol, locale },
    });
    await tx.membership.create({ data: { clerkUserId: userId, orgId: created.id, role: "owner" } });
    return created;
  });

  // Open the company that was just created, rather than leaving them in a previous one.
  await setActiveOrgCookie(org.id);
  revalidatePath("/", "layout");
  return { ok: true as const, orgId: org.id };
}
