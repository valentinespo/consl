import Link from "next/link";
import { ChevronUp, ChevronDown } from "@/components/icons";

const BTN = "inline-flex h-8 w-8 items-center justify-center border border-border bg-surface text-ink-soft";

/** Shopify-style paired chevrons for stepping through a list from inside a detail page.
 *  Ends of the list render as disabled stubs so the control never shifts position. */
export function PrevNextNav({
  prevHref,
  nextHref,
  position,
}: {
  prevHref: string | null;
  nextHref: string | null;
  position?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      {position && <span className="tabular text-[12px] text-muted">{position}</span>}
      <div className="flex">
        {prevHref ? (
          <Link href={prevHref} title="Previous" aria-label="Previous" className={`${BTN} rounded-l-lg transition-colors hover:bg-surface-2 hover:text-ink`}>
            <ChevronUp size={15} />
          </Link>
        ) : (
          <span aria-hidden className={`${BTN} rounded-l-lg opacity-35`}>
            <ChevronUp size={15} />
          </span>
        )}
        {nextHref ? (
          <Link href={nextHref} title="Next" aria-label="Next" className={`${BTN} -ml-px rounded-r-lg transition-colors hover:bg-surface-2 hover:text-ink`}>
            <ChevronDown size={15} />
          </Link>
        ) : (
          <span aria-hidden className={`${BTN} -ml-px rounded-r-lg opacity-35`}>
            <ChevronDown size={15} />
          </span>
        )}
      </div>
    </div>
  );
}

/** Given an ordered list and the current id, build the hrefs + "3 of 7" label. */
export function neighbours(items: { id: string }[], currentId: string, basePath: string) {
  const i = items.findIndex((x) => x.id === currentId);
  if (i === -1) return { prevHref: null, nextHref: null, position: undefined };
  return {
    prevHref: i > 0 ? `${basePath}/${items[i - 1].id}` : null,
    nextHref: i < items.length - 1 ? `${basePath}/${items[i + 1].id}` : null,
    position: `${i + 1} of ${items.length}`,
  };
}
