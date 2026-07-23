import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentOrg } from "@/lib/org";
import { PageHeader } from "@/components/ui";
import { CompanyEditor } from "@/components/CompanyEditor";

export const dynamic = "force-dynamic";

export default async function CompanySettingsPage() {
  const org = await getCurrentOrg();
  if (!org) notFound();

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
        }}
      />
    </>
  );
}
