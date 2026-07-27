"use server";

import { prisma } from "@/lib/prisma";
import { prismaBase } from "@/lib/prisma-base";
import { getCurrentOrgId } from "@/lib/tenant";
import { getOrgSettings, saveOrgSettings } from "@/lib/settings";
import { syncAmazonCore } from "@/lib/sync";
import { getRestock } from "@/lib/restock";
import { revalidatePath } from "next/cache";
import { requireOwner, requirePermission } from "@/lib/membership";
import { saveImage, deleteStored, safeKeySegment } from "@/lib/storage";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));

/** A #rrggbb colour, or the fallback. Anything else would silently print as black on a PO. */
function hexOr(value: string, fallback: string): string {
  const v = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : fallback;
}

/** True when Intl recognises the tag — guards against a typo breaking every formatted value. */
function isValidLocale(tag: string): boolean {
  const t = tag.trim();
  if (!t) return false;
  try {
    return Intl.NumberFormat.supportedLocalesOf([t]).length > 0;
  } catch {
    return false;
  }
}

/** Save the company profile — the name shown in the app, and the sender block, colours and logo
 *  printed on every purchase order. */
export async function updateCompanyProfile(input: {
  name: string;
  legalName: string;
  address: string;
  email: string;
  phone: string;
  currencySymbol: string;
  currencyCode: string;
  locale: string;
  brandInk: string;
  brandBand: string;
}) {
  // The company profile is the sender identity printed on every purchase order and drives the
  // currency every figure is shown in — owner-only, like the brand images beside it.
  const gate = await requireOwner();
  if (!gate.ok) return gate;
  const orgId = gate.orgId;
  const name = input.name.trim();
  if (!name) return { ok: false as const, error: "Company name required" };

  await prismaBase.organization.update({
    where: { id: orgId },
    data: {
      name,
      legalName: input.legalName.trim() || null,
      address: input.address.trim() || null,
      email: input.email.trim() || null,
      phone: input.phone.trim() || null,
      currencySymbol: input.currencySymbol.trim() || "$",
      currencyCode: input.currencyCode.trim().toUpperCase() || "USD",
      // Drives how money, quantities and dates are written. Rejected if it isn't a real locale,
      // so a typo can't leave every number in the app unformatted.
      locale: isValidLocale(input.locale) ? input.locale.trim() : "en-US",
      // Printed on purchase orders. A malformed value would render as black, so fall back.
      brandInk: hexOr(input.brandInk, "#1f2937"),
      brandBand: hexOr(input.brandBand, "#eef2f7"),
    },
  });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Current app settings for the settings panel. */
export async function getAppSettings() {
  const s = await getOrgSettings();
  return {
    syncEnabled: s.syncEnabled,
    syncHour: s.syncHour,
    syncMinute: s.syncMinute,
    syncTz: s.syncTz,
    lastSyncAt: s.lastSyncAt ? s.lastSyncAt.toISOString() : null,
    defaultMinMonths: s.defaultMinMonths,
    defaultLeadMonths: s.defaultLeadMonths,
    shipDays: s.shipDays,
    shipBufferX: s.shipBufferX,
    defaultReorderTo: s.defaultReorderTo,
    defaultBatchSize: s.defaultBatchSize,
  };
}

/** Save the automatic-sync schedule + restock defaults from the settings panel. */
/** Clamp to [lo,hi]; fall back to `fallback` only when the input isn't a finite number (a real 0
 *  is kept). Mirrors the Inventory gear's clamp so the two settings surfaces agree. */
function clampNum(v: number, lo: number, hi: number, fallback: number): number {
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

export async function saveSettings(input: {
  syncEnabled: boolean;
  syncHour: number;
  syncMinute: number;
  syncTz: string;
  defaultMinMonths: number;
  defaultLeadMonths: number;
  shipDays: number;
  shipBufferX: number;
  defaultReorderTo: number;
  defaultBatchSize: number;
}) {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  const data = {
    syncEnabled: !!input.syncEnabled,
    syncHour: clamp(input.syncHour, 0, 23),
    syncMinute: clamp(input.syncMinute, 0, 59),
    syncTz: input.syncTz.trim() || "America/Argentina/Buenos_Aires",
    // Clamp to sane ranges but honour a real 0 where it's meaningful (floor/lead/ship can be 0);
    // only fall back to a default when the value is missing/NaN, matching the Inventory gear so the
    // two editors don't disagree. reorderTo must stay positive (it's a divisor of the order).
    defaultMinMonths: clampNum(input.defaultMinMonths, 0, 120, 5),
    defaultLeadMonths: clampNum(input.defaultLeadMonths, 0, 120, 4.5),
    shipDays: Math.round(clampNum(input.shipDays, 0, 3650, 30)),
    shipBufferX: clampNum(input.shipBufferX, 0, 100, 3),
    defaultReorderTo: clampNum(input.defaultReorderTo, 0.1, 120, 8),
    defaultBatchSize: Math.max(0, Math.round(input.defaultBatchSize)) || 0,
  };
  await saveOrgSettings(data);
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Dismiss a dashboard notification (re-appears if the condition recurs after resolving). */
export async function dismissNotification(key: string) {
  const existing = await prisma.dismissedNotification.findFirst({ where: { key } });
  if (!existing) await prisma.dismissedNotification.create({ data: { key } });
  revalidatePath("/");
  return { ok: true as const };
}

/** Persist the dashboard widget layout (array of { id, x, y, w, h }). */
export async function saveDashboardLayout(layout: { id: string; x: number; y: number; w: number; h: number }[]) {
  // The client already sanitizes, but this action is directly callable — bound every field so a
  // hand-crafted payload (e.g. y = 1e15) can't wedge the compaction loop for the whole org.
  const clean = (Array.isArray(layout) ? layout : []).slice(0, 50).map((it) => ({
    id: String(it?.id ?? "").slice(0, 40),
    x: Math.min(50, Math.max(0, Math.round(Number(it?.x) || 0))),
    y: Math.min(500, Math.max(0, Math.round(Number(it?.y) || 0))),
    w: Math.min(12, Math.max(1, Math.round(Number(it?.w) || 1))),
    h: Math.min(50, Math.max(1, Math.round(Number(it?.h) || 1))),
  }));
  await saveOrgSettings({ dashboardLayout: clean });
  return { ok: true as const };
}

/** Manual "Run now" from the settings panel: sync Amazon + record the value snapshot immediately. */
export async function runSyncNow() {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  try {
    const r = await syncAmazonCore();
    if (r.ok) {
      await getRestock();
      await saveOrgSettings({ lastSyncAt: new Date() });
    }
    revalidatePath("/");
    revalidatePath("/inventory");
    return r;
  } catch (e) {
    // Returned values are NOT redacted the way thrown errors are, so the raw message would reach
    // the browser — Amazon error bodies and Prisma messages name tables, columns and request ids.
    console.error("[runSyncNow]", e);
    return { ok: false as const, error: "The sync couldn't complete. Please try again." };
  }
}


const BRAND_MAX_BYTES = 4 * 1024 * 1024; // 4 MB — these are logos, not photographs
const BRAND_OK_EXT = new Set(["png", "jpg", "jpeg", "webp"]);

export type BrandImageKind = "logo" | "icon";

/**
 * Upload one of the company's two marks. Owners only.
 *  - "logo": the wide one printed across the top of every purchase order.
 *  - "icon": the square one shown beside the company name in the switcher.
 * SVG is deliberately NOT accepted: an SVG can carry script, and the rest of the app rejects it
 * on uploads for that reason. A PNG with transparency does the same job for a logo.
 */
export async function uploadBrandImage(formData: FormData) {
  const gate = await requireOwner();
  if (!gate.ok) return { ok: false as const, error: gate.error };

  const kind = String(formData.get("kind")) as BrandImageKind;
  if (kind !== "logo" && kind !== "icon") return { ok: false as const, error: "Unknown image" };

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { ok: false as const, error: "No file" };
  if (file.size > BRAND_MAX_BYTES) return { ok: false as const, error: "File too large (max 4MB)" };

  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  if (!BRAND_OK_EXT.has(ext)) return { ok: false as const, error: "Use a PNG, JPG or WEBP" };

  // Type comes from the validated extension, never the client-supplied one.
  const type = `image/${ext === "jpg" ? "jpeg" : ext}`;
  const key = `brand/${safeKeySegment(gate.orgId)}-${kind}-${Date.now()}.${ext}`;
  const url = await saveImage(key, Buffer.from(await file.arrayBuffer()), type);

  const previous = await prismaBase.organization.findUnique({
    where: { id: gate.orgId },
    select: { logoUrl: true, iconUrl: true },
  });
  await prismaBase.organization.update({
    where: { id: gate.orgId },
    data: kind === "logo" ? { logoUrl: url } : { iconUrl: url },
  });
  // Drop the file it replaced so old marks don't pile up in storage.
  await deleteStored(kind === "logo" ? previous?.logoUrl : previous?.iconUrl);

  revalidatePath("/", "layout");
  return { ok: true as const, url };
}

/** Remove one of the marks and delete the stored file. Owners only. */
export async function removeBrandImage(kind: BrandImageKind) {
  const gate = await requireOwner();
  if (!gate.ok) return { ok: false as const, error: gate.error };
  if (kind !== "logo" && kind !== "icon") return { ok: false as const, error: "Unknown image" };

  const org = await prismaBase.organization.findUnique({
    where: { id: gate.orgId },
    select: { logoUrl: true, iconUrl: true },
  });
  await prismaBase.organization.update({
    where: { id: gate.orgId },
    data: kind === "logo" ? { logoUrl: null } : { iconUrl: null },
  });
  await deleteStored(kind === "logo" ? org?.logoUrl : org?.iconUrl);

  revalidatePath("/", "layout");
  return { ok: true as const };
}
