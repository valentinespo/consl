import "server-only";
import { prismaBase } from "@/lib/prisma-base";

/**
 * Calendly's API, used for one thing: turning the event the embed reported into the appointment's
 * actual time (and join link) so the waiting screen can say "your call is on Tuesday at 3pm"
 * instead of "you booked something". Needs a personal access token in CALENDLY_TOKEN; without it
 * everything degrades to the booking timestamp.
 */

export type ScheduledCall = { startsAt: Date; endsAt: Date | null; joinUrl: string | null };

export function calendlyConfigured(): boolean {
  return !!process.env.CALENDLY_TOKEN?.trim();
}

export async function fetchScheduledCall(eventUri: string): Promise<ScheduledCall | null> {
  const token = process.env.CALENDLY_TOKEN?.trim();
  if (!token || !/^https:\/\/api\.calendly\.com\/scheduled_events\/[A-Za-z0-9_-]+$/.test(eventUri)) return null;
  try {
    const res = await fetch(eventUri, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as { resource?: { start_time?: string; end_time?: string; location?: { join_url?: string } } };
    const start = json.resource?.start_time ? new Date(json.resource.start_time) : null;
    if (!start || Number.isNaN(start.getTime())) return null;
    const end = json.resource?.end_time ? new Date(json.resource.end_time) : null;
    return { startsAt: start, endsAt: end && !Number.isNaN(end.getTime()) ? end : null, joinUrl: json.resource?.location?.join_url ?? null };
  } catch {
    return null;
  }
}

/** Look the appointment up and remember it on the application. Best-effort; returns what it found. */
export async function recordScheduledCall(applicationId: string, eventUri: string): Promise<ScheduledCall | null> {
  const call = await fetchScheduledCall(eventUri);
  if (!call) return null;
  await prismaBase.accessApplication
    .update({ where: { id: applicationId }, data: { callScheduledAt: call.startsAt, callJoinUrl: call.joinUrl } })
    .catch(() => null);
  return call;
}
