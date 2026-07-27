import { Skeleton, SkelPageHeader, SkelKpis, SkelTable } from "@/components/Skeleton";

/** Inventory: tabs, the total-value card, the KPI row, filter controls, then the SKU table. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading inventory">
      <SkelPageHeader />
      {/* Tabs + sync */}
      <div className="mb-5 flex items-center justify-between">
        <Skeleton className="h-9 w-72 rounded-lg" />
        <Skeleton className="h-9 w-32 rounded-lg" />
      </div>
      {/* Total value card */}
      <div className="mb-3 rounded-[var(--radius-card)] border border-border bg-surface p-5">
        <Skeleton className="h-3.5 w-40" />
        <Skeleton className="mt-3 h-9 w-56" />
        <div className="mt-4 flex flex-wrap gap-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-7 w-32 rounded-full" />
          ))}
        </div>
      </div>
      <div className="mb-5">
        <SkelKpis />
      </div>
      {/* Filter controls */}
      <div className="mb-2 flex flex-wrap items-center gap-2.5">
        <Skeleton className="h-7 w-16" />
        <Skeleton className="h-8 w-40 rounded-lg" />
        <Skeleton className="h-8 w-52 rounded-lg" />
        <Skeleton className="ml-auto h-8 w-48 rounded-lg" />
      </div>
      <SkelTable rows={7} />
    </div>
  );
}
