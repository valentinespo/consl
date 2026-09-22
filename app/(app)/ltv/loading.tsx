export default function Loading() {
  return (
    <div role="status" aria-label="Loading lifetime value" className="space-y-5 animate-pulse">
      <div className="h-12 w-64 rounded-lg bg-surface-2" />
      <div className="flex justify-between gap-3"><div className="h-9 w-80 rounded-[10px] bg-surface-2" /><div className="h-9 w-48 rounded-[10px] bg-surface-2" /></div>
      <div className="grid grid-cols-2 gap-6 rounded-xl border border-border px-5 py-8 lg:grid-cols-4">
        {[1, 2, 3, 4].map((n) => <div key={n} className="space-y-3"><div className="h-3 w-24 rounded bg-surface-2" /><div className="h-7 w-28 rounded bg-surface-2" /><div className="h-3 w-32 rounded bg-surface-2" /></div>)}
      </div>
      <div className="h-80 rounded-xl bg-surface-2" />
    </div>
  );
}
