"use server";

import { revalidatePath } from "next/cache";
import { prismaBase } from "@/lib/prisma-base";
import { currentUserId } from "@/lib/current-user";
import { setActiveOrgCookie } from "@/lib/active-org";
import { createCompanyForUser } from "@/lib/create-company";
import {
  ADS,
  CHALLENGE_MIN,
  CHANNELS,
  FULFILLMENT,
  LONG_TERM_STOCK,
  validEmail,
  type Answers,
  type Choice,
} from "@/components/apply/options";

/**
 * Server side of the early-access questionnaire (/apply). Everything here runs on the UNSCOPED
 * client on purpose: the visitor has no company yet, and AccessApplication is not a tenant table.
 * Rows are keyed by an unguessable id that only the applicant's browser holds; once an account is
 * attached, only that account may touch the row again.
 */

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const clampPct = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : null);

/** Keep only known option keys, capped — the client can't invent options. */
function keys(v: unknown, allowed: Choice[]): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((k): k is string => typeof k === "string" && allowed.some((c) => c.key === k)).slice(0, 20);
}

/** Stored lists carry what was typed for "other" inline, e.g. ["fba", "other:a friend's garage"]. */
function withOther(list: string[], other: string): string[] {
  return list.map((k) => (k === "other" ? `other:${str(other, 120)}` : k));
}

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export type ContactInput = {
  fullName: string;
  companyName: string;
  email: string;
  phone: string;
  /** Honeypot — hidden from people, filled by bots. */
  website?: string;
  source?: string;
};

/** Step one: create the row as soon as we know who they are, so a drop-off still leaves a lead. */
export async function saveContact(input: ContactInput): Promise<Result<{ id: string }>> {
  if (str(input.website, 200)) return { ok: true, id: "ok" };
  const fullName = str(input.fullName, 120);
  const companyName = str(input.companyName, 120);
  const email = str(input.email, 200).toLowerCase();
  const phone = str(input.phone, 40);
  if (fullName.length < 2 || companyName.length < 2 || !validEmail(email)) {
    return { ok: false, error: "Check your name, company and email and try again." };
  }
  const row = await prismaBase.accessApplication.create({
    data: { fullName, companyName, email, phone: phone || null, source: str(input.source, 120) || null },
    select: { id: true },
  });
  return { ok: true, id: row.id };
}

/** Every later step: write whatever is answered so far. `complete` marks the questionnaire done. */
export async function saveAnswers(id: string, a: Answers, opts: { complete?: boolean } = {}): Promise<Result> {
  const app = await prismaBase.accessApplication.findUnique({
    where: { id },
    select: { id: true, clerkUserId: true, status: true },
  });
  if (!app) return { ok: false, error: "Application not found." };
  if (app.clerkUserId && app.clerkUserId !== (await currentUserId())) {
    return { ok: false, error: "This application belongs to another account." };
  }

  const channelKeys = keys(a.channels, CHANNELS);
  const channels = channelKeys
    .map((k) => ({
      key: k,
      label: k === "other" ? str(a.channelOther, 80) || "Other" : CHANNELS.find((c) => c.key === k)!.label,
      share: channelKeys.length === 1 ? 100 : clampPct(a.shares?.[k]),
    }))
    .sort((x, y) => (y.share ?? -1) - (x.share ?? -1));

  const fullName = str(a.fullName, 120);
  const companyName = str(a.companyName, 120);
  const email = str(a.email, 200).toLowerCase();
  const phone = str(a.phone, 40);
  const challenge = str(a.challenge, 8000);
  const lotTracking = a.lotTracking === "yes" || a.lotTracking === "no" ? a.lotTracking : null;

  const finishing = !!opts.complete && challenge.length >= CHALLENGE_MIN && app.status === "started";

  await prismaBase.accessApplication.update({
    where: { id },
    data: {
      ...(fullName.length >= 2 ? { fullName } : {}),
      ...(companyName.length >= 2 ? { companyName } : {}),
      ...(validEmail(email) ? { email } : {}),
      ...(phone ? { phone } : {}),
      channels,
      mainChannel: channels[0]?.key ?? null,
      fulfillment: withOther(keys(a.fulfillment, FULFILLMENT), a.fulfillmentOther),
      longTermStock: withOther(keys(a.longTermStock, LONG_TERM_STOCK), a.longTermStockOther),
      lotTracking,
      lotTrackingTool: lotTracking === "yes" ? str(a.lotTrackingTool, 40) || null : null,
      lotTrackingHow: str(a.lotTrackingHow, 4000) || null,
      adsChannels: withOther(keys(a.ads, ADS), a.adsOther),
      bookkeepingTool: str(a.bookkeepingTool, 40) || null,
      bookkeeping: str(a.bookkeeping, 4000) || null,
      challenge: challenge || null,
      ...(finishing ? { status: "completed", completedAt: new Date() } : {}),
    },
  });
  return { ok: true };
}

/**
 * After the account exists: create the applicant's company from the name they gave, link it to
 * the application, and open it. Idempotent — a second call (a refresh mid-flow, a retry) returns
 * the same company instead of creating another.
 */
export async function attachAccount(id: string): Promise<Result<{ orgId: string }>> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: "Sign in first, then try again." };
  const app = await prismaBase.accessApplication.findUnique({ where: { id } });
  if (!app) return { ok: false, error: "We couldn't find your application. Please start again." };

  if (app.orgId) {
    const member = await prismaBase.membership.findFirst({ where: { orgId: app.orgId, clerkUserId: userId }, select: { id: true } });
    if (!member) return { ok: false, error: "This application is already linked to another account." };
    await setActiveOrgCookie(app.orgId);
    return { ok: true, orgId: app.orgId };
  }
  if (app.clerkUserId && app.clerkUserId !== userId) {
    return { ok: false, error: "This application belongs to another account." };
  }

  const org = await createCompanyForUser({ userId, name: app.companyName, email: app.email, phone: app.phone });
  await prismaBase.accessApplication.update({
    where: { id },
    data: {
      clerkUserId: userId,
      orgId: org.id,
      accountCreatedAt: new Date(),
      ...(app.status === "started" || app.status === "completed" ? { status: "account_created" } : {}),
    },
  });
  await setActiveOrgCookie(org.id);
  revalidatePath("/", "layout");
  return { ok: true, orgId: org.id };
}

/** Calendly confirmed a booking in the embed: remember when, and which event. */
export async function markCallBooked(id: string, eventUri?: string, inviteeUri?: string): Promise<Result> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: "Sign in first." };
  const app = await prismaBase.accessApplication.findUnique({ where: { id }, select: { clerkUserId: true, status: true } });
  if (!app) return { ok: false, error: "Application not found." };
  if (app.clerkUserId && app.clerkUserId !== userId) return { ok: false, error: "This application belongs to another account." };
  await prismaBase.accessApplication.update({
    where: { id },
    data: {
      callBookedAt: new Date(),
      calendlyEventUri: str(eventUri, 300) || null,
      calendlyInviteeUri: str(inviteeUri, 300) || null,
      ...(app.clerkUserId ? {} : { clerkUserId: userId }),
      status: "call_booked",
    },
  });
  return { ok: true };
}
