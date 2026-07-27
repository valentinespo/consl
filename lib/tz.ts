/** Today's calendar date (YYYY-MM-DD) in an IANA timezone. Falls back to UTC on an unknown zone.
 *  Shared so the daily snapshot and the scheduler agree on what "today" means for an org. */
export function localDay(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const m = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    return `${m.year}-${m.month}-${m.day}`;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}
