import "server-only";
import { prismaBase } from "@/lib/prisma-base";

/**
 * Tenant isolation. Every business table carries an `orgId`. These helpers wrap Prisma so
 * that — for those tables — every read is automatically filtered to one org and every write
 * is automatically stamped with it. Safe-by-default: the filter is injected centrally, so a
 * query physically cannot cross tenants even if a caller forgets to scope it.
 */
export const TENANT_MODELS = new Set([
  "Facility",
  "Supplier",
  "Product",
  "SkuSnapshot",
  "DismissedNotification",
  "InventoryValueSnapshot",
  "Settings",
  "MaterialType",
  "PurchaseInvoice",
  "Purchase",
  "Lot",
  "Document",
  "PurchaseOrder",
  "TransactionInvoice",
  "Transaction",
  "LotLine",
  "LotMaterial",
  "PurchaseOrderLine",
]);

const WHERE_OPS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
]);

// Inject orgId into a Prisma operation's args (mutates a shallow copy).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function scopeArgs(operation: string, args: any, orgId: string) {
  const a = { ...(args ?? {}) };
  if (operation === "create") {
    a.data = { ...(a.data ?? {}), orgId };
  } else if (operation === "createMany") {
    const d = a.data;
    a.data = Array.isArray(d) ? d.map((x: Record<string, unknown>) => ({ ...x, orgId })) : { ...d, orgId };
  } else if (operation === "upsert") {
    a.where = { ...(a.where ?? {}), orgId };
    a.create = { ...(a.create ?? {}), orgId };
  } else if (WHERE_OPS.has(operation)) {
    a.where = { ...(a.where ?? {}), orgId };
  }
  return a;
}

/** A Prisma client hard-scoped to one organization. For scripts and explicit-org background work. */
export function tenantDb(orgId: string) {
  return prismaBase.$extends({
    query: {
      $allModels: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async $allOperations({ model, operation, args, query }: any) {
          if (!TENANT_MODELS.has(model)) return query(args);
          return query(scopeArgs(operation, args, orgId));
        },
      },
    },
  });
}

export type TenantDb = ReturnType<typeof tenantDb>;
