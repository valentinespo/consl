import { getProducts, getMaterialTypes } from "@/lib/queries";
import { PageHeader, SectionTitle } from "@/components/ui";
import { NewProductButton, NewMaterialButton } from "@/components/CreateButtons";
import { EditableProductCard, EditableMaterialCard } from "@/components/CatalogCards";

export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const [products, materials] = await Promise.all([getProducts(), getMaterialTypes()]);

  return (
    <>
      <PageHeader
        title="Catalog"
        subtitle="Your products and raw materials. Click the pencil to edit the details and photo."
      />

      <SectionTitle action={<NewProductButton />}>Products</SectionTitle>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((p) => (
          <EditableProductCard key={p.id} product={{ id: p.id, code: p.code, name: p.name, imageUrl: p.imageUrl }} />
        ))}
      </div>

      <div className="mt-8">
        <SectionTitle action={<NewMaterialButton />}>Raw materials</SectionTitle>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {materials.map((m) => (
            <EditableMaterialCard
              key={m.id}
              material={{ id: m.id, code: m.code, name: m.name, unitLabel: m.unitLabel, defaultPerUnit: m.defaultPerUnit, imageUrl: m.imageUrl }}
            />
          ))}
        </div>
      </div>
    </>
  );
}
