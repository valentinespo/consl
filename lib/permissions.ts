/**
 * The permission model: which actions a member may take in each area of the app.
 *
 * A plain module (no "server-only") so both server guards and client UI import the same shapes.
 * Owners are never checked here — they always have every permission. Members carry a per-resource
 * grant map on their Membership; a member with none stored falls back to MEMBER_DEFAULT.
 */

export const RESOURCES = {
  dashboard: { label: "Dashboard", actions: ["view"] },
  inventory: { label: "Inventory", actions: ["view", "edit"] }, // edit = restock settings + sync
  lots: { label: "Production Lots", actions: ["view", "create", "edit", "delete"] },
  transactions: { label: "Transactions", actions: ["view", "create", "edit", "delete"] },
  purchases: { label: "Purchases", actions: ["view", "create", "edit", "delete"] },
  purchaseOrders: { label: "Purchase Orders", actions: ["view", "create", "edit", "delete"] },
  suppliers: { label: "Suppliers", actions: ["view", "create", "edit", "delete"] },
  facilities: { label: "Facilities", actions: ["view", "create", "edit", "delete"] }, // incl. movements
  catalog: { label: "Catalog", actions: ["view", "create", "edit", "delete"] }, // products + materials
  settings: { label: "Settings", actions: ["view", "edit"] },
  team: { label: "Team", actions: ["view", "manage"] }, // manage = invite/remove/permissions
} as const;

export type Resource = keyof typeof RESOURCES;
export type Action = "view" | "create" | "edit" | "delete" | "manage";

/** A member's grants: for each resource, the actions they hold. */
export type Permissions = Partial<Record<Resource, Action[]>>;

export const RESOURCE_KEYS = Object.keys(RESOURCES) as Resource[];

/** Actions a resource actually supports (so the matrix and guards never reference a nonsense pair). */
export function actionsOf(resource: Resource): readonly Action[] {
  return RESOURCES[resource].actions as readonly Action[];
}

/**
 * What a brand-new member can do until an owner customizes them: run day-to-day operations
 * (see + create + edit everywhere operational) but not delete records, not change company settings,
 * and not manage the team. The owner can widen or narrow every box from here.
 */
export const MEMBER_DEFAULT: Permissions = {
  dashboard: ["view"],
  inventory: ["view"],
  lots: ["view", "create", "edit"],
  transactions: ["view", "create", "edit"],
  purchases: ["view", "create", "edit"],
  purchaseOrders: ["view", "create", "edit"],
  suppliers: ["view", "create", "edit"],
  facilities: ["view", "create", "edit"],
  catalog: ["view", "create", "edit"],
  settings: ["view"],
  team: ["view"],
};

/** Full access — what owners have and what the matrix pre-fills when "select all" is used. */
export function fullPermissions(): Permissions {
  return Object.fromEntries(RESOURCE_KEYS.map((r) => [r, [...actionsOf(r)]])) as Permissions;
}

/** Coerce arbitrary stored JSON into a clean Permissions map (drop unknown resources/actions). */
export function normalizePermissions(raw: unknown): Permissions {
  const out: Permissions = {};
  if (!raw || typeof raw !== "object") return out;
  for (const r of RESOURCE_KEYS) {
    const v = (raw as Record<string, unknown>)[r];
    if (Array.isArray(v)) {
      const allowed = actionsOf(r);
      const acts = [
        ...new Set(v.filter((a): a is Action => typeof a === "string" && (allowed as readonly string[]).includes(a))),
      ];
      if (acts.length) out[r] = acts;
    }
  }
  return out;
}

/** The single source of truth for "may this member do this". Owners short-circuit to true. */
export function can(
  role: "owner" | "member",
  perms: Permissions | null | undefined,
  resource: Resource,
  action: Action,
): boolean {
  if (role === "owner") return true;
  const effective = perms ?? MEMBER_DEFAULT;
  return (effective[resource] ?? []).includes(action);
}
