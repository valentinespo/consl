import { SkelPageHeader, SkelTable } from "@/components/Skeleton";

/** lots: a page header over a single table. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading production lots">
      <SkelPageHeader />
      <SkelTable rows={7} avatar={true} />
    </div>
  );
}
