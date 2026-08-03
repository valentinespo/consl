import { NextResponse } from "next/server";
import { prismaBase } from "@/lib/prisma-base";
import { runWithOrg } from "@/lib/tenant";
import { recomputeAll } from "@/lib/recompute";

/**
 * Maintenance-only: run recomputeAll for every org. Used by the single-count plan's phase gates to
 * prove a migration/code change left every persisted cogPerUnit bit-identical (anchor check).
 * Hard-disabled unless ALLOW_DEV_TASKS=1 — the env var is set ONLY in local dev, never on Railway.
 */
export async function POST() {
  if (process.env.ALLOW_DEV_TASKS !== "1") return new Response("Not found", { status: 404 });
  const orgs = await prismaBase.organization.findMany({ where: { deactivatedAt: null }, select: { id: true } });
  for (const o of orgs) await runWithOrg(o.id, () => recomputeAll());
  return NextResponse.json({ ok: true, orgs: orgs.length });
}
