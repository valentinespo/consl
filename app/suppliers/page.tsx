import { getSuppliers } from "@/lib/queries";
import { money } from "@/lib/format";
import { Card, PageHeader } from "@/components/ui";
import { ImageUpload } from "@/components/ImageUpload";

export const dynamic = "force-dynamic";

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}

export default async function SuppliersPage() {
  const suppliers = await getSuppliers();

  return (
    <>
      <PageHeader title="Suppliers" subtitle="Vendor profiles and the activity tied to each. Hover a photo to upload." />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {suppliers.map((s) => (
          <Card key={s.id} className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <ImageUpload
                kind="supplier"
                id={s.id}
                url={s.photoUrl}
                circle
                size={48}
                fallback={
                  <span className="flex h-full w-full items-center justify-center bg-accent text-[15px] font-semibold text-ink">
                    {initials(s.name)}
                  </span>
                }
              />
              <div className="min-w-0">
                <div className="truncate font-semibold text-ink">{s.name}</div>
                <div className="text-[12px] text-muted">{s.email ?? "No contact on file"}</div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 border-t border-line pt-3 text-center">
              <Stat label="Purchases" value={String(s.purchases)} />
              <Stat label="Txns" value={String(s.transactions)} />
              <Stat label="Spend" value={money(s.totalSpend)} />
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[15px] font-semibold text-ink tabular">{value}</div>
      <div className="text-[11px] text-muted">{label}</div>
    </div>
  );
}
