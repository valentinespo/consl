import Link from "next/link";
import { notFound } from "next/navigation";
import { getProductDetail, getProducts } from "@/lib/queries";
import { PageHeader, Card } from "@/components/ui";
import { PrevNextNav, neighbours } from "@/components/PrevNextNav";
import { ProductEditor } from "@/components/ProductEditor";
import { ChannelMapping } from "@/components/ChannelMapping";
import { DeleteEntity } from "@/components/DeleteEntity";
import { deleteProduct } from "@/app/catalog/actions";

export const dynamic = "force-dynamic";

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [detail, products] = await Promise.all([getProductDetail(id), getProducts()]);
  if (!detail) notFound();
  const { product, usedBy } = detail;
  const nav = neighbours(products, id, "/catalog/products");

  return (
    <>
      <Link href="/catalog" className="mb-3 inline-block text-[12.5px] font-medium text-muted hover:text-ink-soft">
        ← Catalog
      </Link>
      <PageHeader title={product.code} subtitle={product.name}>
        <PrevNextNav {...nav} />
      </PageHeader>

      <div className="space-y-5">
        <ProductEditor
          product={{ id: product.id, code: product.code, name: product.name, notes: product.notes, imageUrl: product.imageUrl }}
        />

        <ChannelMapping
          product={{
            id: product.id,
            barcode: product.barcode,
            asin: product.asin,
            sellerSku: product.sellerSku,
            fnsku: product.fnsku,
            shopifyProductId: product.shopifyProductId,
            shopifyVariantId: product.shopifyVariantId,
            shopifySku: product.shopifySku,
            tiktokProductId: product.tiktokProductId,
            tiktokSku: product.tiktokSku,
          }}
        />

        <Card>
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[12px] font-medium uppercase tracking-wide text-muted">Restock policy</div>
            <Link href="/inventory" className="text-[12.5px] font-medium text-accent hover:underline">
              Edit on Inventory →
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Ro label="Floor" value={product.minMonths} suffix="mo" />
            <Ro label="Lead time" value={product.leadMonths} suffix="mo" />
            <Ro label="Shipping time" value={product.shipDays} suffix="d" />
            <Ro label="Reorder to" value={product.reorderToMonths} suffix="mo" />
            <Ro label="Batch size" value={product.batchSize} suffix="units" />
          </div>
        </Card>
      </div>

      <DeleteEntity
        kind="product"
        name={product.name}
        usedBy={usedBy}
        onDelete={deleteProduct.bind(null, product.id)}
        redirectTo="/catalog"
      />
    </>
  );
}

function Ro({ label, value, suffix }: { label: string; value: number | null; suffix?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2/50 px-3 py-2">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="tabular mt-0.5 text-[14px] font-medium text-ink">
        {value == null ? <span className="text-[13px] text-muted">Using default</span> : `${value}${suffix ? ` ${suffix}` : ""}`}
      </div>
    </div>
  );
}
