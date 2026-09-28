import type { SelectMenuOption } from "@/components/SelectMenu";

/** A picker option that may belong to an archived product or material. */
export type ArchivableOption = SelectMenuOption & { archived?: boolean };

/**
 * The options one picker field offers: every active item, plus an archived item only while it is
 * this field's current value — kept so an existing record still reads right, but shown as not
 * choosable. Archived items are never offered for a new choice.
 */
export function liveOptions(options: ArchivableOption[], current: string | null | undefined): SelectMenuOption[] {
  return options
    .filter((o) => !o.archived || o.value === current)
    .map(({ archived, ...o }) => (archived ? { ...o, disabled: true, hint: o.hint ? `${o.hint} · Archived` : "Archived" } : o));
}
