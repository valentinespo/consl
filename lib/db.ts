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
  "StockMovement",
  "Integration",
  "ChannelListing",
  "ChannelStock",
  "SalesOrder",
  "FinanceEvent",
  "SalesOrderLine",
  // Scoped for the owner's view (listing / revoking). Accepting an invite deliberately uses the
  // unscoped client instead: the invitee has no organization yet, and the token is the credential.
  "Invite",
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
  "updateManyAndReturn",
  "delete",
  "deleteMany",
]);

const CREATE_ONE_OPS = new Set(["create"]);
const CREATE_MANY_OPS = new Set(["createMany", "createManyAndReturn"]);

/** Operations that carry no tenant-scopable args. Anything outside every set throws — a new
 *  Prisma release can't quietly introduce an unscoped write path. */
const NO_SCOPE_OPS = new Set(["aggregateRaw", "findRaw", "$queryRaw", "$executeRaw", "$runCommandRaw"]);

/** Nested-write keys whose payloads are rows of a related model, so they need stamping too. */
const NESTED_CREATE_KEYS = ["create", "createMany", "connectOrCreate", "upsert"] as const;

/** Every verb Prisma allows inside a relation write. Used to tell a real nested write apart from
 *  a plain Json column that happens to contain a key called "create". */
const RELATION_VERBS = new Set([
  "create", "createMany", "connectOrCreate", "connect", "disconnect",
  "update", "updateMany", "upsert", "delete", "deleteMany", "set",
]);

/** True only when `v` looks unambiguously like a relation write: an object whose keys are ALL
 *  Prisma relation verbs, at least one of which creates rows. */
function isRelationWrite(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const keys = Object.keys(v as object);
  if (keys.length === 0) return false;
  return keys.every((k) => RELATION_VERBS.has(k)) && keys.some((k) => NESTED_CREATE_KEYS.includes(k as never));
}

/** Recursively stamp orgId onto a write payload and every nested row it creates.
 *  Prisma only hands the extension the top-level model, so a nested `{ lines: { create: [...] } }`
 *  would otherwise write children with orgId = null — invisible to every scoped read. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function stampData(data: any, orgId: string): any {
  if (Array.isArray(data)) return data.map((d) => stampData(d, orgId));
  if (!data || typeof data !== "object") return data;

  const out: Record<string, unknown> = { ...data, orgId };
  for (const [field, value] of Object.entries(data)) {
    if (field === "orgId" || !isRelationWrite(value)) continue;
    const nested = value;
    const verbs = NESTED_CREATE_KEYS.filter((k) => k in nested);
    const rewritten: Record<string, unknown> = { ...nested };
    for (const verb of verbs) {
      if (verb === "connectOrCreate") {
        const coc = nested.connectOrCreate;
        const one = (c: Record<string, unknown>) => ({ ...c, create: stampData(c.create, orgId) });
        rewritten.connectOrCreate = Array.isArray(coc)
          ? coc.map((c) => one(c as Record<string, unknown>))
          : one(coc as Record<string, unknown>);
      } else if (verb === "upsert") {
        const up = nested.upsert;
        const one = (u: Record<string, unknown>) => ({
          ...u,
          create: stampData(u.create, orgId),
          update: stampData(u.update, orgId),
        });
        rewritten.upsert = Array.isArray(up)
          ? up.map((u) => one(u as Record<string, unknown>))
          : one(up as Record<string, unknown>);
      } else if (verb === "createMany") {
        const cm = nested.createMany as Record<string, unknown>;
        rewritten.createMany = { ...cm, data: stampData(cm.data, orgId) };
      } else {
        rewritten.create = stampData(nested.create, orgId);
      }
    }
    out[field] = rewritten;
  }
  return out;
}

// Inject orgId into a Prisma operation's args (returns a shallow copy; never mutates the input).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function scopeArgs(operation: string, args: any, orgId: string) {
  const a = { ...(args ?? {}) };
  if (CREATE_ONE_OPS.has(operation)) {
    a.data = stampData(a.data ?? {}, orgId);
  } else if (CREATE_MANY_OPS.has(operation)) {
    a.data = stampData(a.data ?? {}, orgId);
  } else if (operation === "upsert") {
    a.where = { ...(a.where ?? {}), orgId };
    a.create = stampData(a.create ?? {}, orgId);
    a.update = stampData(a.update ?? {}, orgId);
  } else if (WHERE_OPS.has(operation)) {
    a.where = { ...(a.where ?? {}), orgId };
    // An update's payload can carry nested relation writes (`lines: { create: [...] }`), and those
    // children need the stamp too. This was the one unstamped write path — it quietly produced
    // orphan rows with a NULL orgId (invisible to every scoped read) until the DB-level NOT NULL
    // constraint turned it into a hard error on PO edits.
    if (operation === "update" && a.data) a.data = stampData(a.data, orgId);
  } else if (!NO_SCOPE_OPS.has(operation)) {
    throw new Error(
      `Tenant scoping has no rule for Prisma operation "${operation}". Add it to lib/db.ts before using it — ` +
        `an unhandled operation would run unscoped across every organization.`,
    );
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
