import Link from "next/link";
import { ChevronRight, Package } from "@/components/icons";
import { Card, SkuAvatar } from "@/components/ui";

const CARD = "flex items-center gap-3 transition-colors hover:border-accent-strong hover:bg-accent-soft/30";

function Thumb({ url, alt, fallback }: { url: string | null; alt: string; fallback: React.ReactNode }) {
  if (!url) return <span className="flex h-14 w-14 shrink-0 items-center justify-center">{fallback}</span>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={alt} className="h-14 w-14 shrink-0 rounded-[10px] border border-border object-cover" />
  );
}

/** Catalog tile — a link into the product's own page, where all editing now lives. */
export function ProductCard({ product }: { product: { id: string; code: string; name: string; imageUrl: string | null } }) {
  return (
    <Link href={`/catalog/products/${product.id}`} className="block">
      <Card className={CARD}>
        <Thumb url={product.imageUrl} alt={product.code} fallback={<SkuAvatar code={product.code} size={56} />} />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-ink">{product.code}</div>
          <div className="truncate text-[12.5px] text-muted">{product.name}</div>
        </div>
        <ChevronRight size={16} className="shrink-0 text-muted" />
      </Card>
    </Link>
  );
}

export function MaterialCard({
  material,
}: {
  material: { id: string; code: string; name: string; unitLabel: string; defaultPerUnit: number; lowStockThreshold: number | null; imageUrl: string | null };
}) {
  return (
    <Link href={`/catalog/materials/${material.id}`} className="block">
      <Card className={CARD}>
        <Thumb url={material.imageUrl} alt={material.name} fallback={<Package size={26} className="text-muted" />} />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-ink">{material.name}</div>
          <div className="truncate text-[12.5px] text-muted">
            {material.defaultPerUnit} {material.unitLabel}/unit default
            {material.lowStockThreshold != null && ` · alert < ${material.lowStockThreshold.toLocaleString()}`}
          </div>
        </div>
        <ChevronRight size={16} className="shrink-0 text-muted" />
      </Card>
    </Link>
  );
}
