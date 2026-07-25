import Link from "next/link";
import { notFound } from "next/navigation";
import { getMaterialDetail, getMaterialTypes } from "@/lib/queries";
import { PageHeader } from "@/components/ui";
import { PrevNextNav, neighbours } from "@/components/PrevNextNav";
import { MaterialEditor } from "@/components/MaterialEditor";
import { DeleteEntity } from "@/components/DeleteEntity";
import { deleteMaterial } from "@/app/catalog/actions";

export const dynamic = "force-dynamic";

export default async function MaterialDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [detail, materials] = await Promise.all([getMaterialDetail(id), getMaterialTypes()]);
  if (!detail) notFound();
  const { material, usedBy } = detail;
  const nav = neighbours(materials, id, "/catalog/materials");

  return (
    <>
      <Link href="/catalog" className="mb-3 inline-block text-[12.5px] font-medium text-muted hover:text-ink-soft">
        ← Catalog
      </Link>
      <PageHeader title={material.name} subtitle={`Raw material · ${material.code}`}>
        <PrevNextNav {...nav} />
      </PageHeader>

      <MaterialEditor
        material={{
          id: material.id,
          code: material.code,
          name: material.name,
          unitLabel: material.unitLabel,
          defaultPerUnit: material.defaultPerUnit,
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
      />
    </>
  );
}
