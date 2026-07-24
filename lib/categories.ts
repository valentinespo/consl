/** Transaction cost categories.
 *
 * A category is a free-form label. Two "seed" categories contribute to COG (Ingredients,
 * Production); one reserved label — "Not applicable" — is excluded from COG (fees, certifications,
 * anything that isn't a product cost). Beyond the seeds, users type their own from the dropdown.
 *
 * Categories are NOT a stored table: the selectable list is the seeds plus whatever categories are
 * currently used by at least one transaction (derived like suppliers). Delete the last transaction
 * using a custom category and it drops off the list until typed again.
 */

/** The reserved category that never flows into COG. */
export const NOT_APPLICABLE = "Not applicable";

/** COG-contributing seed categories, always offered even with no data yet. */
export const SEED_COG_CATEGORIES = ["Ingredients", "Production"];

/** Full seed list for the dropdown (COG seeds first, "Not applicable" last). */
export const SEED_CATEGORIES = [...SEED_COG_CATEGORIES, NOT_APPLICABLE];

/** True for the reserved excluded-from-COG category. */
export function isExcludedCategory(category: string): boolean {
  return category.trim().toLowerCase() === NOT_APPLICABLE.toLowerCase();
}

/** Seeds + in-use categories, de-duplicated, with the reserved one pinned last. */
export function categoryOptions(inUse: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of [...SEED_COG_CATEGORIES, ...inUse]) {
    const t = c.trim();
    if (!t || isExcludedCategory(t)) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  out.push(NOT_APPLICABLE);
  return out;
}
