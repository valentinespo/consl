import { Skeleton } from "@/components/Skeleton";

/**
 * Route-level loading state: while any page's data streams in, the chrome (header + sidebar)
 * stays put and the content area shows this shimmering outline of a typical page — title, a
 * headline card, a KPI row, then a table. Shaped to roughly match every screen in the app, so
 * navigation feels like the page is assembling rather than popping in.
 */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading page">
      {/* Page title + subtitle */}
      <Skeleton className="h-8 w-48" />
      <Skeleton className="mt-2.5 h-4 w-80 max-w-full" />

      {/* Headline card */}
      <div className="mt-7 rounded-[var(--radius-card)] border border-border bg-surface p-5">
        <Skeleton className="h-3.5 w-36" />
        <Skeleton className="mt-3 h-9 w-56" />
        <div className="mt-4 flex flex-wrap gap-2">
          <Skeleton className="h-7 w-32 rounded-full" />
          <Skeleton className="h-7 w-36 rounded-full" />
          <Skeleton className="h-7 w-40 rounded-full" />
          <Skeleton className="h-7 w-32 rounded-full" />
        </div>
      </div>

      {/* KPI row */}
      <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="mt-2.5 h-6 w-12" />
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="mt-6 overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
        <div className="border-b border-border bg-surface-2/60 px-4 py-3">
          <Skeleton className="h-3 w-64 max-w-full" />
        </div>
        {Array.from({ length: 6 }, (_, i) => (
          <div
            key={i}
            className={`flex items-center gap-4 px-4 py-4 ${i < 5 ? "border-b border-line" : ""}`}
          >
            <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
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
    </div>
  );
}
