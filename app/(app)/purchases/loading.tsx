import { SkelPageHeader, SkelTable } from "@/components/Skeleton";

/** purchases: a page header over a single table. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading purchases">
      <SkelPageHeader />
      <SkelTable rows={8} avatar={false} />
    </div>
  );
}
