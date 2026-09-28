import Link from "next/link";
import { notFound } from "next/navigation";
import { getMaterialDetail, getMaterialTypes } from "@/lib/queries";
import { PageHeader } from "@/components/ui";
import { PrevNextNav, neighbours } from "@/components/PrevNextNav";
import { MaterialEditor } from "@/components/MaterialEditor";
import { DeleteEntity } from "@/components/DeleteEntity";
import { deleteMaterial } from "@/app/(app)/catalog/actions";
import { requireView } from "@/lib/membership";

export const dynamic = "force-dynamic";

export default async function MaterialDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireView("catalog");
  const { id } = await params;
  const [detail, materials] = await Promise.all([getMaterialDetail(id), getMaterialTypes()]);
  if (!detail) notFound();
  const { material, usedBy } = detail;
  // An archived material pages through the archived ones, an active one through the active ones.
  const archived = !!materials.find((m) => m.id === id)?.archivedAt;
  const nav = neighbours(materials.filter((m) => !!m.archivedAt === archived), id, "/catalog/materials");

  return (
    <>
      <Link href={archived ? "/catalog?view=archived" : "/catalog"} className="mb-3 inline-block text-[12.5px] font-medium text-muted hover:text-ink-soft">
        ← {archived ? "Archived" : "Catalog"}
      </Link>
      <PageHeader title={material.name} subtitle="Raw material">
        <span className="inline-flex items-center gap-2">
          {archived && <span className="pill-neutral inline-flex items-center rounded-full px-2 py-[3px] text-[11px] font-medium leading-none">Archived</span>}
          <PrevNextNav {...nav} />
        </span>
      </PageHeader>

      <MaterialEditor
        material={{
          id: material.id,
          name: material.name,
          unitLabel: material.unitLabel,
          lowStockThreshold: material.lowStockThreshold,
          skuSpecific: material.skuSpecific,
          imageUrl: material.imageUrl,
        }}
        locked={Object.keys(usedBy).length > 0}
      />

      <DeleteEntity
        kind="raw material"
        name={material.name}
        usedBy={usedBy}
        onDelete={deleteMaterial.bind(null, material.id)}
        redirectTo="/catalog"
        resource="catalog"
      />
    </>
  );
}
