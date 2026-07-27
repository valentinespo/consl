import { notFound } from "next/navigation";
import { currentUserId } from "@/lib/current-user";
import { getCurrentOrg } from "@/lib/org";
import { currentRole } from "@/lib/membership";
import { prisma } from "@/lib/prisma";
import { prismaBase } from "@/lib/prisma-base";
import { CompanyEditor } from "@/components/CompanyEditor";
import { TeamCard } from "@/components/TeamCard";
import { DeleteOrganization } from "@/components/DeleteOrganization";
import { date as fmtDate } from "@/lib/format";
import { fullPermissions, normalizePermissions, MEMBER_DEFAULT } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function CompanySettingsPage() {
  const org = await getCurrentOrg();
  if (!org) notFound();

  const userId = await currentUserId();
  const role = await currentRole();
  const cur = { symbol: org.currencySymbol, locale: org.locale, code: org.currencyCode };

  // Memberships are cross-tenant by nature, so they're read unscoped and filtered to this org.
  const [memberships, invites] = await Promise.all([
    prismaBase.membership.findMany({ where: { orgId: org.id }, orderBy: { createdAt: "asc" } }),
    prisma.invite.findMany({ where: { acceptedAt: null }, orderBy: { createdAt: "desc" } }),
  ]);

  return (
    <>
      <CompanyEditor
        company={{
          name: org.name,
          legalName: org.legalName,
          address: org.address,
          email: org.email,
          phone: org.phone,
          currencySymbol: org.currencySymbol,
          currencyCode: org.currencyCode,
          locale: org.locale,
          brandInk: org.brandInk,
          brandBand: org.brandBand,
          logoUrl: org.logoUrl,
          iconUrl: org.iconUrl,
        }}
        isOwner={role === "owner"}
      />
      <TeamCard
        isOwner={role === "owner"}
        members={memberships.map((m) => ({
          clerkUserId: m.clerkUserId,
          role: m.role,
          createdAt: fmtDate(m.createdAt, cur),
          isYou: m.clerkUserId === userId,
          // Owners are always full; a member with no stored grants sits on the default baseline.
          permissions:
            m.role === "owner"
              ? fullPermissions()
              : m.permissions != null
                ? normalizePermissions(m.permissions)
                : MEMBER_DEFAULT,
        }))}
        invites={invites.map((iv) => ({
          id: iv.id,
          email: iv.email,
          role: iv.role,
          // The token IS the credential to join at that role. Only ever ship it to an owner — a
          // member who could read a pending owner-invite token from the page payload could accept
          // it from a second account and promote themselves.
          token: role === "owner" ? iv.token : null,
          expiresAt: fmtDate(iv.expiresAt, cur),
        }))}
      />
      <DeleteOrganization orgName={org.name} isOwner={role === "owner"} />
    </>
  );
}
