import { SkelPageHeader, SkelTable } from "@/components/Skeleton";

/** purchase-orders: a page header over a single table. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading purchase orders">
      <SkelPageHeader />
      <SkelTable rows={7} avatar={false} />
    </div>
  );
}
