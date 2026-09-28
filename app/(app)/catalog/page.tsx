import Link from "next/link";
import { Archive, ArrowLeftRight, Boxes, ChevronLeft, Package } from "@/components/icons";
import { getProducts, getMaterialTypes } from "@/lib/queries";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionTitle } from "@/components/ui";
import { NewProductButton, NewMaterialButton } from "@/components/CreateButtons";
import { ProductCard, MaterialCard } from "@/components/CatalogCards";
import { EmptyState } from "@/components/EmptyState";
import { requireView } from "@/lib/membership";

export const dynamic = "force-dynamic";

const LINK_BUTTON = "inline-flex items-center gap-1.5 rounded-lg border border-border bg-panel px-3 py-1.5 text-[12.5px] font-medium text-ink hover:bg-panel-2";
const GRID = "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3";

type Material = Awaited<ReturnType<typeof getMaterialTypes>>[number];
const materialCard = (m: Material) => ({
  id: m.id,
  code: m.code,
  name: m.name,
  unitLabel: m.unitLabel,
  lowStockThreshold: m.lowStockThreshold,
  skuSpecific: m.skuSpecific,
  imageUrl: m.imageUrl,
});

/**
 * The catalog: active products and raw materials, or — with ?view=archived — the archived ones,
 * each with an Unarchive in its ⋯ menu. The Archived button only appears once something is.
 */
export default async function CatalogPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireView("catalog");
  const sp = await searchParams;
  const [allProducts, allMaterials, channelConn] = await Promise.all([
    getProducts(),
    getMaterialTypes(),
    prisma.integration.findFirst({
      where: { provider: { in: ["amazon", "shopify"] }, status: "connected" },
      select: { id: true },
    }),
  ]);
  const products = allProducts.filter((p) => !p.archivedAt);
  const materials = allMaterials.filter((m) => !m.archivedAt);
  const archivedProducts = allProducts.filter((p) => p.archivedAt);
  const archivedMaterials = allMaterials.filter((m) => m.archivedAt);
  const archivedCount = archivedProducts.length + archivedMaterials.length;

  if (sp.view === "archived") {
    return (
      <>
        <PageHeader title="Archived" subtitle="Hidden from the catalog, every dropdown and Reorder. Their stock, costs, history and sales still count.">
          <Link href="/catalog" className={LINK_BUTTON}>
            <ChevronLeft size={13} />
            Back to catalog
          </Link>
        </PageHeader>
        {archivedCount === 0 ? (
          <EmptyState icon={Archive} title="Nothing archived" body="Archive a product or raw material from the ⋯ menu on its card, and it shows up here.">
            <Link href="/catalog" className={LINK_BUTTON}>
              Back to catalog
            </Link>
          </EmptyState>
        ) : (
          <>
            {archivedProducts.length > 0 && (
              <>
                <SectionTitle>Products</SectionTitle>
                <div className={GRID}>
                  {archivedProducts.map((p) => (
                    <ProductCard key={p.id} archived product={{ id: p.id, code: p.code, name: p.name, imageUrl: p.imageUrl }} />
                  ))}
                </div>
              </>
            )}
            {archivedMaterials.length > 0 && (
              <div className={archivedProducts.length > 0 ? "mt-8" : undefined}>
                <SectionTitle>Raw materials</SectionTitle>
                <div className={GRID}>
                  {archivedMaterials.map((m) => (
                    <MaterialCard key={m.id} archived material={materialCard(m)} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </>
    );
  }

  const productActions = (
    <span className="inline-flex items-center gap-2">
      {channelConn && (
        <Link href="/catalog/mapping" className={LINK_BUTTON}>
          <ArrowLeftRight size={13} />
          Product mapping
        </Link>
      )}
      <NewProductButton />
    </span>
  );
  const allArchived = (what: string) => (
    <div className="rounded-xl border border-border bg-panel px-4 py-6 text-center text-[13px] text-ink-soft">
      Every {what} is archived.{" "}
      <Link href="/catalog?view=archived" className="font-medium text-accent hover:underline">
        Open Archived
      </Link>{" "}
      to bring one back.
    </div>
  );

  return (
    <>
      <PageHeader title="Catalog" subtitle="Your products and raw materials. Open one to edit its details, photo and sales-channel IDs.">
        {archivedCount > 0 && (
          <Link href="/catalog?view=archived" className={LINK_BUTTON}>
            <Archive size={13} />
            Archived
            <span className="tabular text-muted">{archivedCount}</span>
          </Link>
        )}
      </PageHeader>

      <SectionTitle action={productActions}>Products</SectionTitle>
      {products.length === 0 && archivedProducts.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="No products yet"
          body="Products are the finished items you sell. Add your first one to start tracking production, cost and stock."
        >
          {productActions}
        </EmptyState>
      ) : products.length === 0 ? (
        allArchived("product")
      ) : (
        <div className={GRID}>
          {products.map((p) => (
            <ProductCard key={p.id} product={{ id: p.id, code: p.code, name: p.name, imageUrl: p.imageUrl }} />
          ))}
        </div>
      )}

      <div className="mt-8">
        <SectionTitle action={<NewMaterialButton />}>Raw materials</SectionTitle>
        {materials.length === 0 && archivedMaterials.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No raw materials yet"
            body="Raw materials are what your products are made from. Adding them lets the app work out cost per unit automatically."
          >
            <NewMaterialButton />
          </EmptyState>
        ) : materials.length === 0 ? (
          allArchived("raw material")
        ) : (
          <div className={GRID}>
            {materials.map((m) => (
              <MaterialCard key={m.id} material={materialCard(m)} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
