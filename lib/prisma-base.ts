import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../app/generated/prisma/client";

// The raw, UNSCOPED Prisma client. Use only for cross-tenant/system tables
// (Organization, Membership) and inside the tenant layer itself. App code should
// import `prisma` from "@/lib/prisma" (the auto-scoped client) instead.
const globalForPrisma = globalThis as unknown as { prismaBase?: PrismaClient };
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

export const prismaBase = globalForPrisma.prismaBase ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") globalForPrisma.prismaBase = prismaBase;
