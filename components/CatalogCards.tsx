import Link from "next/link";
import { Package } from "@/components/icons";
import { Card, SkuAvatar } from "@/components/ui";
import { HoverHint } from "@/components/HoverHint";
import { CatalogItemMenu } from "@/components/CatalogItemMenu";

// Right padding keeps the text clear of the ⋯ menu, which sits over the card's top-right corner
// (a sibling of the link, not inside it: a button can't live in an <a>).
const CARD = "flex items-center gap-3 pr-11 transition-colors hover:border-accent-strong hover:bg-accent-soft/30";

function Thumb({ url, alt, fallback }: { url: string | null; alt: string; fallback: React.ReactNode }) {
  if (!url) return <span className="flex h-14 w-14 shrink-0 items-center justify-center">{fallback}</span>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={alt} className="h-14 w-14 shrink-0 rounded-[10px] border border-border object-cover" />
  );
}

/** Catalog tile — a link into the product's own page, where all editing now lives, with the ⋯
 *  menu (archive / unarchive) in its corner. */
export function ProductCard({ product, archived = false }: { product: { id: string; code: string; name: string; imageUrl: string | null }; archived?: boolean }) {
  return (
    <div className="relative">
      <Link href={`/catalog/products/${product.id}`} className="block">
        <Card className={CARD}>
          <Thumb url={product.imageUrl} alt={product.code} fallback={<SkuAvatar code={product.code} size={56} />} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold text-ink">{product.name}</div>
            <div className="truncate text-[12.5px] text-muted">{product.code}</div>
          </div>
        </Card>
      </Link>
      <div className="absolute right-2 top-2">
        <CatalogItemMenu kind="product" id={product.id} name={product.name} archived={archived} />
      </div>
    </div>
  );
}

export function MaterialCard({
  material,
  archived = false,
}: {
  material: { id: string; code: string; name: string; unitLabel: string; lowStockThreshold: number | null; skuSpecific: boolean; imageUrl: string | null };
  archived?: boolean;
}) {
  return (
    <div className="relative">
      <Link href={`/catalog/materials/${material.id}`} className="block">
        <Card className={CARD}>
          <Thumb url={material.imageUrl} alt={material.name} fallback={<Package size={26} className="text-muted" />} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-semibold text-ink">{material.name}</span>
              {/* Same quiet tag the facility cards use for their type — it states a property of the
                  material, not a status, so it stays neutral rather than taking a pill colour. The
                  hint icon carries the explanation (a native title tooltip was unreliable). */}
              {material.skuSpecific && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-[10.5px] font-medium text-muted">
                  SKU-Specific
                  <HoverHint
                    title="SKU-specific material"
                    size={11}
                    body="Each product keeps its own stock of this material — like printed pouches, where every SKU has a different design. You pick the product when buying it, and each SKU's stock is costed from its own pool. Materials without this tag come from one shared pool used across all products, like plain tea bags."
                  />
                </span>
              )}
            </div>
            {/* The label is shown exactly as the tenant typed it — no pluralising, so "kg", "each"
                and non-English units all read correctly. */}
            <div className="truncate text-[12.5px] text-muted">
              Unit label: {material.unitLabel}
              {material.lowStockThreshold != null && ` · alert < ${material.lowStockThreshold.toLocaleString()}`}
            </div>
          </div>
        </Card>
      </Link>
      <div className="absolute right-2 top-2">
        <CatalogItemMenu kind="material" id={material.id} name={material.name} archived={archived} />
      </div>
    </div>
  );
}
