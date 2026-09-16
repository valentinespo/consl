"use server";

import { revalidatePath } from "next/cache";
import { currentUserId } from "@/lib/current-user";
import { setActiveOrgCookie } from "@/lib/active-org";
import { createCompanyForUser } from "@/lib/create-company";

export type NewCompany = {
  name: string;
  currencyCode: string;
  currencySymbol: string;
  locale: string;
};

/**
 * Create a company for the signed-in user and make them its owner. A person can belong to several
 * — running more than one business, or being invited into a client's — so this is not limited to
 * their first. The rows themselves are written by lib/create-company (shared with the early-access
 * flow), which also decides whether the new company is billing-exempt.
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

  const org = await createCompanyForUser({ userId, name, currencyCode, currencySymbol, locale });

  // Open the company that was just created, rather than leaving them in a previous one.
  await setActiveOrgCookie(org.id);
  revalidatePath("/", "layout");
  return { ok: true as const, orgId: org.id };
}
