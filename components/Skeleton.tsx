/** A shimmering placeholder bar — size it with width/height classes. Purely decorative, so it's
 *  hidden from screen readers; the loading page announces itself once via aria-busy instead. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`skeleton ${className}`} />;
}

/* Shared building blocks for the per-route loading screens. Each route composes these into an
 * outline of its own layout, so navigating to Suppliers shimmers like a card grid and navigating
 * to Lots shimmers like a table — not every page pretending to be the dashboard. */

/** Page title + subtitle, matching PageHeader's footprint. */
export function SkelPageHeader() {
  return (
    <div className="mb-7">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="mt-2.5 h-4 w-80 max-w-full" />
    </div>
  );
}

/** A row of KPI tiles. */
export function SkelKpis({ n = 5 }: { n?: number }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="mt-2.5 h-6 w-12" />
        </div>
      ))}
    </div>
  );
}

/** A table card: header band, then rows — with or without a leading avatar square. */
export function SkelTable({ rows = 7, avatar = true }: { rows?: number; avatar?: boolean }) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
      <div className="border-b border-border bg-surface-2/60 px-4 py-3">
        <Skeleton className="h-3 w-64 max-w-full" />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={`flex items-center gap-4 px-4 py-4 ${i < rows - 1 ? "border-b border-line" : ""}`}>
          {avatar && <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />}
          <div className="min-w-0 flex-1">
            <Skeleton className="h-4 w-44 max-w-full" />
            <Skeleton className="mt-2 h-3 w-28" />
          </div>
          <Skeleton className="hidden h-4 w-24 sm:block" />
          <Skeleton className="hidden h-6 w-24 rounded-full md:block" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

/** A responsive grid of entity cards (suppliers, facilities, catalog tiles). */
export function SkelCards({ n = 6, image = false }: { n?: number; image?: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
          <div className="flex items-center gap-3">
            <Skeleton className={image ? "h-14 w-14 shrink-0 rounded-lg" : "h-10 w-10 shrink-0 rounded-full"} />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-32 max-w-full" />
              <Skeleton className="mt-2 h-3 w-20" />
            </div>
          </div>
          <Skeleton className="mt-4 h-3 w-full" />
          <Skeleton className="mt-2 h-3 w-3/4" />
        </div>
      ))}
    </div>
  );
}
