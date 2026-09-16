import { SkelPageHeader, SkelCards } from "@/components/Skeleton";

/** facilities: a page header over a grid of entity cards. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading facilities">
      <SkelPageHeader />
      <SkelCards n={6} image={false} />
    </div>
  );
}
