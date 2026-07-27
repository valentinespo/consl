import { SkelPageHeader, SkelCards } from "@/components/Skeleton";

/** catalog: a page header over a grid of entity cards. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading catalog">
      <SkelPageHeader />
      <SkelCards n={6} image={true} />
    </div>
  );
}
