import "server-only";
import { cache } from "react";
import { prismaBase } from "@/lib/prisma-base";
import { getCurrentOrgId } from "@/lib/tenant";

export type OrgProfile = {
  id: string;
  name: string;
  legalName: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  logoUrl: string | null;
  iconUrl: string | null;
  brandInk: string;
  brandBand: string;
  currencyCode: string;
  currencySymbol: string;
  locale: string;
};

/** The signed-in user's company profile. Cached per request — this is read by the layout,
 *  the sidebar and every generated PO, and replaces the old hardcoded company constant. */
export const getCurrentOrg = cache(async (): Promise<OrgProfile | null> => {
  const orgId = await getCurrentOrgId();
  if (!orgId) return null;
  const org = await prismaBase.organization.findUnique({ where: { id: orgId } });
  if (!org) return null;
  return {
    id: org.id,
    name: org.name,
    legalName: org.legalName,
    address: org.address,
    email: org.email,
    phone: org.phone,
    logoUrl: org.logoUrl,
    iconUrl: org.iconUrl,
    brandInk: org.brandInk,
    brandBand: org.brandBand,
    currencyCode: org.currencyCode,
    currencySymbol: org.currencySymbol,
    locale: org.locale,
  };
});

/** What to print as the sender on documents: legal name if set, else the display name. */
export function orgDocumentName(org: OrgProfile | null): string {
  return org?.legalName?.trim() || org?.name?.trim() || "";
}

/** Address block for documents — the company name followed by its address lines. */
export function orgAddressLines(org: OrgProfile | null): string[] {
  const lines = [orgDocumentName(org)];
  if (org?.address) lines.push(...org.address.split("\n").map((l) => l.trim()).filter(Boolean));
  return lines.filter(Boolean);
}
