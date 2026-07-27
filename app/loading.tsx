import { Skeleton, SkelPageHeader } from "@/components/Skeleton";

/**
 * Dashboard loading state — shaped like the dashboard's widget grid: the value card with its
 * chart beside the alerts card, then the facility donuts beside the recent-lots table. Routes
 * with their own layout carry their own loading.tsx; this one also catches any stragglers.
 */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading page">
      <SkelPageHeader />

      <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
        {/* Total value card with chart */}
        <div className="rounded-[var(--radius-card)] border border-border bg-surface p-5">
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="mt-3 h-9 w-56" />
          <div className="mt-4 flex flex-wrap gap-2">
            <Skeleton className="h-7 w-32 rounded-full" />
            <Skeleton className="h-7 w-36 rounded-full" />
            <Skeleton className="h-7 w-32 rounded-full" />
          </div>
          <Skeleton className="mt-5 h-36 w-full" />
        </div>
        {/* Alerts card */}
        <div className="rounded-[var(--radius-card)] border border-border bg-surface p-5">
          <Skeleton className="h-4 w-32" />
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
          <Skeleton className="mt-4 h-3.5 w-full" />
          <Skeleton className="mt-2.5 h-3.5 w-5/6" />
          <Skeleton className="mt-2.5 h-3.5 w-4/6" />
        </div>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[2fr_3fr]">
        {/* Facility donuts */}
        <div className="rounded-[var(--radius-card)] border border-border bg-surface p-5">
          <Skeleton className="h-4 w-36" />
          <div className="mt-5 flex items-center justify-around">
            <Skeleton className="h-28 w-28 rounded-full" />
            <Skeleton className="h-28 w-28 rounded-full" />
          </div>
          <Skeleton className="mt-5 h-3.5 w-full" />
          <Skeleton className="mt-2.5 h-3.5 w-4/5" />
        </div>
        {/* Recent lots */}
        <div className="rounded-[var(--radius-card)] border border-border bg-surface p-5">
          <Skeleton className="h-4 w-44" />
          <div className="mt-4">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className={`flex items-center gap-4 py-3 ${i < 4 ? "border-b border-line" : ""}`}>
                <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="ml-auto h-4 w-16" />
                <Skeleton className="hidden h-6 w-24 rounded-full sm:block" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
