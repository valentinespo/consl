import { Boxes, Package } from "@/components/icons";
import { getProducts, getMaterialTypes } from "@/lib/queries";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionTitle } from "@/components/ui";
import { NewProductButton, NewMaterialButton, ImportAmazonCatalogButton } from "@/components/CreateButtons";
import { ProductCard, MaterialCard } from "@/components/CatalogCards";
import { EmptyState } from "@/components/EmptyState";
import { requireView } from "@/lib/membership";

export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  await requireView("catalog");
  const [products, materials, amazonConn] = await Promise.all([
    getProducts(),
    getMaterialTypes(),
    prisma.integration.findFirst({ where: { provider: "amazon", status: "connected" }, select: { id: true } }),
  ]);

  const productActions = (
    <span className="inline-flex items-center gap-2">
      {amazonConn && <ImportAmazonCatalogButton />}
      <NewProductButton />
    </span>
  );

  return (
    <>
      <PageHeader title="Catalog" subtitle="Your products and raw materials. Open one to edit its details, photo and sales-channel IDs." />

      <SectionTitle action={productActions}>Products</SectionTitle>
      {products.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="No products yet"
          body="Products are the finished items you sell. Add your first one to start tracking production, cost and stock."
        >
          {productActions}
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => (
            <ProductCard key={p.id} product={{ id: p.id, code: p.code, name: p.name, imageUrl: p.imageUrl }} />
          ))}
        </div>
      )}

      <div className="mt-8">
        <SectionTitle action={<NewMaterialButton />}>Raw materials</SectionTitle>
        {materials.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No raw materials yet"
            body="Raw materials are what your products are made from. Adding them lets the app work out cost per unit automatically."
          >
            <NewMaterialButton />
          </EmptyState>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {materials.map((m) => (
              <MaterialCard
                key={m.id}
                material={{
                  id: m.id,
                  code: m.code,
                  name: m.name,
                  unitLabel: m.unitLabel,
                  defaultPerUnit: m.defaultPerUnit,
                  lowStockThreshold: m.lowStockThreshold,
                  imageUrl: m.imageUrl,
                }}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
