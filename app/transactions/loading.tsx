import { SkelPageHeader, SkelTable } from "@/components/Skeleton";

/** transactions: a page header over a single table. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading transactions">
      <SkelPageHeader />
      <SkelTable rows={8} avatar={false} />
    </div>
  );
}
