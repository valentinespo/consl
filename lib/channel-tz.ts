/**
 * Every sales channel cuts its day on its own clock, and that clock is rarely the operator's:
 * Amazon's reports run on the marketplace's local time (Pacific for Amazon.com), a Shopify store
 * reports in the timezone set in its admin, TikTok Shop in the shop's region. All timestamps are
 * stored as exact instants; the timezone only decides which "day" an instant belongs to when a
 * statement is cut — so a channel's own statement can match the channel's own reports to the
 * cent, while cross-channel views use the company's business day.
 */

/** Amazon marketplace → the timezone Seller Central cuts its business reports on. */
const AMAZON_MARKETPLACE_TZ: Record<string, string> = {
  ATVPDKIKX0DER: "America/Los_Angeles", // US
  A2EUQ1WTGCTBG2: "America/Los_Angeles", // CA — North America unified account reports in PT
  A1AM78C64UM0Y8: "America/Los_Angeles", // MX
  A2Q3Y263D00KWC: "America/Sao_Paulo", // BR
  A1F83G8C2ARO7P: "Europe/London", // UK
  A1PA6795UKMFR9: "Europe/Paris", // DE
  A13V1IB3VIYZZH: "Europe/Paris", // FR
  APJ6JRA9NG5V4: "Europe/Paris", // IT
  A1RKKUPIHCS9HS: "Europe/Paris", // ES
  A1805IZSGTT6HH: "Europe/Paris", // NL
  A2NODRKZP88ZB9: "Europe/Paris", // SE
  A1C3SOZRARQ6R3: "Europe/Paris", // PL
  AMEN7PMS3EDWL: "Europe/Paris", // BE
  A33AVAJ2PDY3EV: "Europe/Istanbul", // TR
  ARBP9OOSHTCHU: "Africa/Cairo", // EG
  A2VIGQ35RCS4UG: "Asia/Dubai", // AE
  A17E79C6D8DWNP: "Asia/Riyadh", // SA
  A21TJRUUN4KGV: "Asia/Kolkata", // IN
  A19VAU5U5O7RUS: "Asia/Singapore", // SG
  A1VC38T7YXB528: "Asia/Tokyo", // JP
  A39IBJ37TRP1C6: "Australia/Sydney", // AU
};

/** TikTok Shop region → the shop's local timezone. */
const TIKTOK_REGION_TZ: Record<string, string> = {
  US: "America/Los_Angeles",
  GB: "Europe/London",
  UK: "Europe/London",
  DE: "Europe/Berlin",
  FR: "Europe/Paris",
  ES: "Europe/Madrid",
  IT: "Europe/Rome",
  IE: "Europe/Dublin",
  MX: "America/Mexico_City",
  BR: "America/Sao_Paulo",
  SG: "Asia/Singapore",
  MY: "Asia/Kuala_Lumpur",
  TH: "Asia/Bangkok",
  VN: "Asia/Ho_Chi_Minh",
  PH: "Asia/Manila",
  ID: "Asia/Jakarta",
  JP: "Asia/Tokyo",
};

/** The channel's own calendar for a connection, or null when the platform never told us. A stored
 *  timezone (Shopify reports the shop's; any provider can be overridden) wins over the derivation. */
export function channelTimezone(conn: {
  provider: string;
  timezone?: string | null;
  marketplaceId?: string | null;
  region?: string | null;
}): string | null {
  if (conn.timezone) return conn.timezone;
  if (conn.provider === "amazon") return AMAZON_MARKETPLACE_TZ[conn.marketplaceId ?? ""] ?? null;
  if (conn.provider === "tiktok") return TIKTOK_REGION_TZ[(conn.region ?? "").toUpperCase()] ?? null;
  return null;
}

/** "America/Los_Angeles" → "Pacific Time" (falls back to the city name). */
export function describeTimezone(tz: string): string {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longGeneric" })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName")?.value;
    if (part && !/^GMT/.test(part)) return part;
  } catch {
    // unknown zone name — fall through to the city
  }
  return tz.split("/").pop()?.replace(/_/g, " ") ?? tz;
}

/** Today's calendar date (YYYY-MM-DD) in `tz`. */
export function todayIn(tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const m = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${m.year}-${m.month}-${m.day}`;
}

/** Amazon marketplace → the currency its ledger settles in. */
const AMAZON_MARKETPLACE_CURRENCY: Record<string, string> = {
  ATVPDKIKX0DER: "USD", A2EUQ1WTGCTBG2: "CAD", A1AM78C64UM0Y8: "MXN", A2Q3Y263D00KWC: "BRL",
  A1F83G8C2ARO7P: "GBP", A1PA6795UKMFR9: "EUR", A13V1IB3VIYZZH: "EUR", APJ6JRA9NG5V4: "EUR",
  A1RKKUPIHCS9HS: "EUR", A1805IZSGTT6HH: "EUR", A2NODRKZP88ZB9: "SEK", A1C3SOZRARQ6R3: "PLN",
  AMEN7PMS3EDWL: "EUR", A33AVAJ2PDY3EV: "TRY", ARBP9OOSHTCHU: "EGP", A2VIGQ35RCS4UG: "AED",
  A17E79C6D8DWNP: "SAR", A21TJRUUN4KGV: "INR", A19VAU5U5O7RUS: "SGD", A1VC38T7YXB528: "JPY",
  A39IBJ37TRP1C6: "AUD",
};

export function amazonMarketplaceCurrency(marketplaceId: string | null | undefined): string {
  return AMAZON_MARKETPLACE_CURRENCY[marketplaceId ?? ""] ?? "USD";
}
