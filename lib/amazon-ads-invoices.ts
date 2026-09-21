import "server-only";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/org";
import { getOrgSettings, saveOrgSettings } from "@/lib/settings";
import { fxRate } from "@/lib/fx";
import { adsClient, flagAdsReconnect } from "@/lib/amazon-ads";
import { adProgramLabel } from "@/lib/ads-waterfill";

/**
 * Amazon Ads' own invoices (the Billing API): every invoice of the advertiser whatever the payment
 * method, with its exact period — and, in its detail, how it was paid and what it billed per ad
 * program. The statement books ad spend from the money report plus these (lib/ads-waterfill
 * `unifyAdInvoices`): a company paying by card has no ad charge in its money report at all.
 *
 * Two steps, both cheap: LIST (100 per page) and DETAIL (one call per invoice, read once — and
 * again only while the invoice's status can still change). A login without billing rights gets
 * 403: the import is skipped and the statement keeps working from the money report alone.
 *
 * OUTAGES AND LATE CHANGES. The recent list starts two months before the NEWEST INVOICE ON RECORD
 * — not before today — so a connection that was down for one month or for five lists everything
 * issued meanwhile the first time it is back; nothing depends on how long it was away. And the
 * whole history is listed again once a day, because an old invoice can still change: Amazon has
 * written one off four months after issuing it.
 */
const PROVIDER = "amazon_ads";
const LIST_EVERY_MS = 55 * 60_000;
const FULL_LIST_EVERY_MS = 23 * 60 * 60_000;
const RECENT_DAYS = 62;
const DETAILS_PER_PASS = 60;
const DETAIL_PARALLEL = 3;
const FINAL = new Set(["PAID_IN_FULL", "WRITTEN_OFF"]);
const NO_DETAIL = new Set(["ACCUMULATING", "PROCESSING"]);
/** Payment methods that take the money out of the seller's balance — it shows in the money report. */
const BALANCE_METHODS = new Set(["UNIFIED_BILLING", "DEDUCT_FROM_PAYMENT"]);

type Money = { amount?: number; currencyCode?: string };
type Summary = { id?: string | number; status?: string; fromDate?: string; toDate?: string; invoiceDate?: string; amountDue?: Money; taxAmountDue?: Money; paymentMethod?: string };
type Detail = { invoiceSummary?: Summary; payments?: { paymentMethod?: string; status?: string; amount?: Money }[]; invoiceLines?: { programName?: string; cost?: Money }[] };

/** Amazon writes dates as YYYYMMDD. */
const dayOf = (d: unknown): string | null => (typeof d === "string" && /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null);

export async function syncAmazonAdsInvoices(): Promise<{ listed: number; detailed: number; skipped?: string }> {
  const client = await adsClient();
  if (!client) return { listed: 0, detailed: 0 };
  const headers = { ...client.headers, Accept: "application/json" };
  const settings = await getOrgSettings();
  const baseCurrency = (await getCurrentOrg())?.currencyCode ?? "USD";

  let listed = 0;
  const due = !settings.amazonAdsInvoicesSyncedAt || Date.now() - settings.amazonAdsInvoicesSyncedAt.getTime() > LIST_EVERY_MS;
  if (due) {
    const newest = (await prisma.adInvoice.findFirst({ where: { provider: PROVIDER, invoiceDay: { not: null } }, orderBy: { invoiceDay: "desc" }, select: { invoiceDay: true } }))?.invoiceDay ?? null;
    const first = !newest || !settings.amazonAdsInvoicesFullAt || Date.now() - settings.amazonAdsInvoicesFullAt.getTime() > FULL_LIST_EVERY_MS;
    const since = newest ? new Date(new Date(`${newest}T00:00:00Z`).getTime() - RECENT_DAYS * 86_400_000).toISOString().slice(0, 10) : "";
    let complete = false;
    let cursor: string | null = null;
    for (let page = 0; page < 80; page++) {
      const url = new URL(`${client.host}/invoices`);
      if (cursor) url.searchParams.set("cursor", cursor);
      else {
        url.searchParams.set("count", "100");
        // Amazon's reference says ISO-8601; the API itself only takes yyyyMMdd (checked live).
        if (!first) url.searchParams.set("startDate", since.replaceAll("-", ""));
      }
      const r = await fetch(url, { headers });
      if (r.status === 401) {
        await flagAdsReconnect(client.integrationId, "Amazon refused the stored sign-in");
        return { listed, detailed: 0, skipped: "sign-in expired" };
      }
      if (r.status === 403) {
        console.warn("[amazon-ads] invoices: 403, this login has no billing access; the statement keeps using the money report alone");
        await saveOrgSettings({ amazonAdsInvoicesSyncedAt: new Date() });
        return { listed: 0, detailed: 0, skipped: "no billing access" };
      }
      if (!r.ok) {
        console.warn(`[amazon-ads] invoices: ${r.status} ${(await r.text()).slice(0, 160)}`);
        return { listed, detailed: 0, skipped: `list ${r.status}` };
      }
      const j = (await r.json()) as { payload?: { invoiceSummaries?: Summary[]; nextCursor?: string | null }; invoiceSummaries?: Summary[]; nextCursor?: string | null };
      const list = j.payload?.invoiceSummaries ?? j.invoiceSummaries ?? [];
      for (const s of list) {
        if (s.id === undefined || s.id === null || !s.status) continue;
        const externalId = String(s.id);
        const amount = Number(s.amountDue?.amount) || 0;
        const currency = s.amountDue?.currencyCode || "USD";
        const invoiceDay = dayOf(s.invoiceDate);
        const at = new Date(`${invoiceDay ?? dayOf(s.toDate) ?? new Date().toISOString().slice(0, 10)}T12:00:00Z`);
        const fx = currency === baseCurrency ? 1 : await fxRate(currency, baseCurrency, at);
        const data = { status: s.status, fromDay: dayOf(s.fromDate), toDay: dayOf(s.toDate), invoiceDay, amount, tax: Number(s.taxAmountDue?.amount) || 0, currency, baseAmount: Math.round(amount * fx * 100) / 100 };
        const existing = await prisma.adInvoice.findFirst({ where: { provider: PROVIDER, externalId }, select: { id: true, status: true, amount: true } });
        if (!existing) await prisma.adInvoice.create({ data: { provider: PROVIDER, externalId, ...data } });
        // A changed status or amount means the detail read earlier is stale too.
        else if (existing.status !== s.status || existing.amount !== amount) await prisma.adInvoice.update({ where: { id: existing.id }, data: { ...data, detailAt: null } });
        listed++;
      }
      cursor = j.payload?.nextCursor ?? j.nextCursor ?? null;
      if (!cursor || list.length === 0) {
        complete = true;
        break;
      }
    }
    // Only a list read to its end moves the markers: one cut short is simply read again.
    if (complete) await saveOrgSettings({ amazonAdsInvoicesSyncedAt: new Date(), ...(first ? { amazonAdsInvoicesFullAt: new Date() } : {}) });
  }

  // Details: never-read invoices first (newest first), then the ones whose status can still move.
  const pending = await prisma.adInvoice.findMany({
    where: { provider: PROVIDER, status: { notIn: [...NO_DETAIL] }, OR: [{ detailAt: null }, { status: { notIn: [...FINAL] }, detailAt: { lt: new Date(Date.now() - LIST_EVERY_MS) } }] },
    orderBy: [{ detailAt: { sort: "asc", nulls: "first" } }, { toDay: "desc" }],
    take: DETAILS_PER_PASS,
    select: { id: true, externalId: true, amount: true, baseAmount: true },
  });
  let detailed = 0;
  let throttled = false;
  for (let i = 0; i < pending.length && !throttled; i += DETAIL_PARALLEL) {
    await Promise.all(
      pending.slice(i, i + DETAIL_PARALLEL).map(async (inv) => {
        const r = await fetch(`${client.host}/invoices/${encodeURIComponent(inv.externalId)}`, { headers });
        if (r.status === 429) {
          throttled = true;
          return;
        }
        if (!r.ok) return; // left unread; the next pass asks again
        const j = (await r.json()) as { payload?: Detail } & Detail;
        const d: Detail = j.payload ?? j;
        // Money that went through the seller's balance — succeeded, or charged and later refunded
        // there (a written-off invoice): both legs are in the money report.
        const viaBalance = (d.payments ?? []).filter((p) => BALANCE_METHODS.has(p.paymentMethod ?? "") && (p.status === "SUCCEEDED" || p.status === "REFUNDED")).reduce((t, p) => t + (Number(p.amount?.amount) || 0), 0);
        // In the company's currency, like `baseAmount`.
        const rate = inv.amount ? (inv.baseAmount ?? inv.amount) / inv.amount : 1;
        const programs: Record<string, number> = {};
        for (const l of d.invoiceLines ?? []) {
          const cost = Number(l.cost?.amount) || 0;
          if (cost > 0) programs[adProgramLabel(l.programName ?? "")] = Math.round(((programs[adProgramLabel(l.programName ?? "")] ?? 0) + cost) * 100) / 100;
        }
        await prisma.adInvoice.update({
          where: { id: inv.id },
          data: { paymentMethod: d.invoiceSummary?.paymentMethod ?? d.payments?.[0]?.paymentMethod ?? null, balancePaid: Math.round(Math.min(viaBalance, inv.amount) * rate * 100) / 100, programs, detailAt: new Date() },
        });
        detailed++;
      }),
    );
  }
  return { listed, detailed };
}
