import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUserId } from "@/lib/current-user";
import { getCurrentOrg } from "@/lib/org";
import { currentRole } from "@/lib/membership";
import { prisma } from "@/lib/prisma";
import { prismaBase } from "@/lib/prisma-base";
import { PageHeader } from "@/components/ui";
import { CompanyEditor } from "@/components/CompanyEditor";
import { TeamCard } from "@/components/TeamCard";
import { date as fmtDate } from "@/lib/format";

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
      <Link href="/" className="mb-3 inline-block text-[12.5px] font-medium text-muted hover:text-ink-soft">
        ← Dashboard
      </Link>
      <PageHeader title="Company" subtitle="Your business details, used across the app and on generated documents." />
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
        }}
      />
      <TeamCard
        isOwner={role === "owner"}
        members={memberships.map((m) => ({
          clerkUserId: m.clerkUserId,
          role: m.role,
          createdAt: fmtDate(m.createdAt, cur),
          isYou: m.clerkUserId === userId,
        }))}
        invites={invites.map((iv) => ({
          id: iv.id,
          email: iv.email,
          role: iv.role,
          token: iv.token,
          expiresAt: fmtDate(iv.expiresAt, cur),
        }))}
      />
    </>
  );
}
