import { prismaBase } from "@/lib/prisma-base";
import { TENANT_MODELS, scopeArgs } from "@/lib/db";
import { getCurrentOrgId } from "@/lib/tenant";

/**
 * The app-facing Prisma client. For business tables it automatically filters reads to the
 * current org and stamps writes with it (org resolved from the logged-in user, or an explicit
 * background context via runWithOrg). Cross-tenant tables (Organization, Membership) pass through.
 * A tenant query with no org in context fails closed rather than leaking across companies.
 */
export const prisma = prismaBase.$extends({
  query: {
    $allModels: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async $allOperations({ model, operation, args, query }: any) {
        if (!TENANT_MODELS.has(model)) return query(args);
        const orgId = await getCurrentOrgId();
        if (!orgId) throw new Error(`Tenant query ${model}.${operation} with no organization in context`);
        return query(scopeArgs(operation, args, orgId));
      },
    },
  },
});
