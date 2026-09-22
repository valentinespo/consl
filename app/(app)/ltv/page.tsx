import { PageHeader } from "@/components/ui";
import { LtvClient } from "@/components/LtvClient";
import { requireView, getMyAccess } from "@/lib/membership";
import { getLtvData } from "@/lib/ltv-data";

export const dynamic = "force-dynamic";

export default async function LtvPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireView("dashboard");
  const [data, access] = await Promise.all([getLtvData(await searchParams), getMyAccess()]);
  return <>
    <PageHeader title="Lifetime value" subtitle="Understand what customers are worth, from their first purchase onward." />
    <LtvClient data={data} canEdit={access?.can("settings", "edit") ?? false} />
  </>;
}
