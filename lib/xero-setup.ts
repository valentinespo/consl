import "server-only";
import { Prisma } from "@/app/generated/prisma/client";
import { prismaBase } from "@/lib/prisma-base";
import { runWithOrg } from "@/lib/tenant";
import { BALANCE_SHEET_SCOPE, xeroAccessToken, xeroApi } from "@/lib/xero";
import { devAccounts, devBalances, devFixture, type FixtureAccount } from "@/lib/xero-dev-fixture";
import { localDay } from "@/lib/tz";
import { loadPnlHistory } from "@/lib/pnl-cache";
import { PNL_SOURCE_ORDER, pnlLineOf, sourcesFromBits } from "@/lib/pnl-shared";
import {
  CHANNEL_NAME,
  CHANNEL_ORDER,
  CLASS_OF_TYPE,
  INVENTORY_ADJUSTMENT_KEY,
  INVENTORY_ADJUSTMENT_SUGGEST,
  LINES,
  SHARED_RECEIVABLE_KEY,
  SHARED_RECEIVABLE_SUGGEST,
  isReceivableKey,
  LINE_ORDER,
  customClass,
  dayBefore,
  isIsoDay,
  lockedAccountOf,
  newAccountName,
  setupLineId,
  type BalanceRow,
  type CustomChoice,
  type InventoryOpening,
  type SetupLine,
  type StartingInventory,
  type Suggestion,
  type XeroAccountOption,
  type XeroChannel,
  type XeroSetupState,
  type XeroTarget,
} from "@/lib/xero-setup-shared";

/**
 * The Xero export's setup (the account behind every P&L line and balance account) — loaded for
 * the setup screen, saved from it as a draft (consl only), and published. Reading and saving a
 * draft never change anything in Xero; publishing creates the new accounts the owner accepted and
 * the "Sales channel" tracking category when channel tags are on, then stores the setup the monthly
 * journals use.
 *
 * A new account is always a new account: a name already taken in Xero is refused, never quietly
 * swapped for the existing account — except accounts consl itself created for this company
 * (createdAccountIds, recorded the moment each is made), so a save that failed halfway retries
 * cleanly instead of tripping over its own accounts.
 */

const DEV_FIXTURE = process.env.NODE_ENV !== "production" && process.env.XERO_DEV_FIXTURE === "1";

type XeroApiAccount = FixtureAccount & { Class?: string };
type Stored = { accountId: string; code: string; name: string; type: string };

/** The Xero account class behind each type — a suggestion only matches an account of its class. */
const CLASS_OF: Record<string, string> = {
  REVENUE: "REVENUE",
  SALES: "REVENUE",
  OTHERINCOME: "REVENUE",
  DIRECTCOSTS: "EXPENSE",
  EXPENSE: "EXPENSE",
  OVERHEADS: "EXPENSE",
  DEPRECIATN: "EXPENSE",
  CURRENT: "ASSET",
  INVENTORY: "ASSET",
  PREPAYMENT: "ASSET",
  FIXED: "ASSET",
  NONCURRENT: "ASSET",
  BANK: "ASSET",
  CURRLIAB: "LIABILITY",
  LIABILITY: "LIABILITY",
  TERMLIAB: "LIABILITY",
  EQUITY: "EQUITY",
};

/** The account types a new account is numbered next to, closest first (inventory with the current assets, not the fixed ones). */
const CODE_FAMILY: Record<string, string[]> = {
  REVENUE: ["REVENUE", "SALES", "OTHERINCOME"],
  OTHERINCOME: ["OTHERINCOME", "REVENUE", "SALES"],
  DIRECTCOSTS: ["DIRECTCOSTS"],
  EXPENSE: ["EXPENSE", "OVERHEADS"],
  CURRENT: ["CURRENT", "PREPAYMENT", "INVENTORY"],
  INVENTORY: ["INVENTORY", "CURRENT", "PREPAYMENT"],
  CURRLIAB: ["CURRLIAB", "LIABILITY"],
};

/** Where consl numbers the accounts it creates, per type (the first free code in the range). */
const CODE_RANGE: Record<string, [number, number]> = {
  REVENUE: [210, 299],
  SALES: [210, 299],
  OTHERINCOME: [275, 299],
  DIRECTCOSTS: [320, 399],
  EXPENSE: [410, 499],
  OVERHEADS: [410, 499],
  CURRENT: [640, 699],
  INVENTORY: [635, 699],
  CURRLIAB: [840, 899],
};

// Bank accounts can't take manual journals, and system accounts (receivables, payables, tax,
// retained earnings) are Xero's own.
const usable = (a: XeroApiAccount) => a.Status === "ACTIVE" && a.Type !== "BANK" && !a.SystemAccount;
const option = (a: XeroApiAccount): XeroAccountOption => ({ accountId: a.AccountID, code: a.Code ?? "", name: a.Name, type: a.Type });
const byCode = (a: XeroAccountOption, b: XeroAccountOption) => a.code.localeCompare(b.code, undefined, { numeric: true }) || a.name.localeCompare(b.name);
const norm = (s: string) => s.trim().toLowerCase();

/** A live Xero connection; `readsBalances`: it was granted the balance sheet (connections made
 *  before consl asked for it grant it by reconnecting). */
type Conn = { token: string; tenantId: string; orgName: string; readsBalances: boolean };

async function connection(orgId: string): Promise<{ conn: Conn } | { state: "not_connected" } | { state: "reconnect"; orgName: string | null; message: string }> {
  if (DEV_FIXTURE) return { conn: { token: "dev", tenantId: "dev", orgName: devFixture.orgName, readsBalances: process.env.XERO_DEV_NO_BALANCES !== "1" } };
  const row = await prismaBase.integration.findUnique({ where: { orgId_provider: { orgId, provider: "xero" } } });
  if (!row || !row.refreshTokenEnc || row.status === "revoked" || row.status === "choose") return { state: "not_connected" };
  if (row.status === "error" || !row.sellerId) {
    return { state: "reconnect", orgName: row.accountName, message: "consl's access to Xero ended. Reconnect Xero to continue." };
  }
  const token = await xeroAccessToken(row);
  const readsBalances = (row.scope ?? "").split(/\s+/).includes(BALANCE_SHEET_SCOPE);
  return { conn: { token, tenantId: row.sellerId, orgName: row.accountName ?? "your Xero organisation", readsBalances } };
}

async function allAccounts(c: Conn): Promise<XeroApiAccount[]> {
  if (DEV_FIXTURE) return devAccounts;
  const res = await xeroApi<{ Accounts?: XeroApiAccount[] }>(c.token, c.tenantId, "/Accounts");
  return res.Accounts ?? [];
}

/** The company's P&L lines, all time (from the P&L's own history, so they are exactly the
 *  statement's), and the balance accounts they need. */
async function companyRows(orgId: string): Promise<{ channels: XeroChannel[]; lines: SetupLine[]; balances: BalanceRow[] }> {
  const tz = await companyZone(orgId);
  const [hist, metaAccounts, adsConn] = await Promise.all([
    runWithOrg(orgId, () => loadPnlHistory(tz)),
    prismaBase.metaAdAccount.count({ where: { orgId } }),
    prismaBase.integration.findUnique({ where: { orgId_provider: { orgId, provider: "amazon_ads" } }, select: { id: true } }),
  ]);
  const isChannel = (c: string): c is XeroChannel => (CHANNEL_ORDER as string[]).includes(c);
  const types = new Map<string, { channel: XeroChannel; group: string; type: string; amount: number; bits: number }>();
  const cogs = new Map<XeroChannel, number>();
  for (const d of hist.days) {
    if (!isChannel(d.c)) continue;
    for (const [group, type, amount, bits] of d.rows) {
      const k = `${d.c}|${group}|${type}`;
      const t = types.get(k) ?? { channel: d.c, group, type, amount: 0, bits: 0 };
      t.amount += amount;
      t.bits |= bits;
      types.set(k, t);
    }
    if (d.cogs || d.units) cogs.set(d.c, (cogs.get(d.c) ?? 0) + d.cogs);
  }
  const byId = new Map<string, SetupLine>();
  for (const t of types.values()) {
    const sources = sourcesFromBits(t.bits);
    // A fee or credit added in consl keeps its own name (as the P&L shows it) and is placed on its
    // own; every other line is the P&L's grouped line.
    const custom = sources.length > 0 && sources.every((x) => x === "CUSTOM");
    const line = custom ? t.type : pnlLineOf(t.group, t.type, sources);
    const id = setupLineId(t.channel, t.group, custom ? `custom:${t.type}` : line);
    const cur = byId.get(id) ?? { id, channel: t.channel, group: t.group, line, amount: 0, sources: [], custom };
    cur.amount += t.amount;
    cur.sources = PNL_SOURCE_ORDER.filter((x) => cur.sources.includes(x) || sources.includes(x));
    byId.set(id, cur);
  }
  for (const l of byId.values()) if (l.custom) l.credit = l.group === "sales" || l.amount > 0;
  for (const [channel, amount] of cogs) {
    const id = setupLineId(channel, "cogs", "Cost of goods");
    byId.set(id, { id, channel, group: "cogs", line: "Cost of goods", amount, sources: ["CONSL"], custom: false });
  }
  const order = [...LINE_ORDER, "taxes"] as string[];
  const lines = [...byId.values()]
    .map((l) => ({ ...l, amount: Math.round(l.amount * 100) / 100 }))
    .sort(
      (a, b) =>
        CHANNEL_ORDER.indexOf(a.channel) - CHANNEL_ORDER.indexOf(b.channel) ||
        (order.indexOf(a.group) + 1 || 99) - (order.indexOf(b.group) + 1 || 99) ||
        Math.abs(b.amount) - Math.abs(a.amount),
    );

  const sourced = (src: string) => lines.some((l) => (l.sources as string[]).includes(src));
  const channels = CHANNEL_ORDER.filter((c) => lines.some((l) => l.channel === c) || sourced(c));
  const balances: BalanceRow[] = channels.map((channel) => ({
    key: `receivable:${channel}`,
    channel,
    label: `${CHANNEL_NAME[channel]} receivable`,
    hint: `What ${CHANNEL_NAME[channel]} owes you.`,
    suggest: { name: `${CHANNEL_NAME[channel]} Receivable`, type: "CURRENT" },
  }));
  // Tax owed is the state's money, not income: it waits here until it's paid over.
  if (lines.some((l) => l.group === "taxes")) {
    balances.push({
      key: "sales_tax",
      label: "Sales tax payable",
      hint: "Tax your customers paid that you still owe the state (the P&L's Tax owed). Tax a channel pays over for you never lands here.",
      suggest: { name: "Sales Tax Payable", type: "CURRLIAB" },
    });
  }
  if (metaAccounts > 0 || sourced("META")) {
    balances.push({ key: "payable:META_ADS", label: "Meta Ads payable", hint: "Meta ad spend you haven't paid yet.", suggest: { name: "Meta Ads Payable", type: "CURRLIAB" } });
  }
  if (adsConn || sourced("AMAZON_ADS")) {
    balances.push({ key: "payable:AMAZON_ADS", label: "Amazon Ads payable", hint: "Amazon ad invoices you pay by card, until the card is charged.", suggest: { name: "Amazon Ads Payable", type: "CURRLIAB" } });
  }
  balances.push({
    key: "inventory",
    label: "Inventory",
    hint: "Your stock at landed cost.",
    suggest: { name: "Inventory", type: "INVENTORY" },
  });

  return { channels, lines, balances };
}

/**
 * The account consl proposes for a row: always a NEW account, named "consl - <line>" (the
 * founder's rule: never auto-pick one of the company's accounts; the owner can pick one, or rename
 * the new one). The one exception is an account consl already created under that very name.
 */
function suggest(s: Suggestion, ours: Map<string, XeroAccountOption>): XeroTarget {
  const name = newAccountName(s.name);
  const made = ours.get(norm(name));
  return made ? { kind: "account", ...made } : { kind: "new", name, type: s.type };
}

/** The company's own clock (the one the P&L cuts its days on). */
async function companyZone(orgId: string): Promise<string> {
  const row = await prismaBase.settings.findFirst({ where: { orgId }, select: { syncTz: true } });
  return row?.syncTz ?? "UTC";
}

const idList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** consl's own accounts in the chart, by name — the only same-name accounts it may reuse. */
function oursByName(accounts: XeroAccountOption[], createdIds: string[]): Map<string, XeroAccountOption> {
  const ids = new Set(createdIds);
  return new Map(accounts.filter((a) => ids.has(a.accountId)).map((a) => [norm(a.name), a]));
}

export type XeroSetupScreen = {
  state: "ready";
  orgName: string;
  accounts: XeroAccountOption[];
  channels: XeroChannel[];
  lines: SetupLine[];
  balances: BalanceRow[];
  /** What Xero has now (null until the first publish). */
  published: XeroSetupState | null;
  /** Where the screen starts: the saved draft, else what's published, else consl's defaults. */
  current: XeroSetupState;
  /** consl's defaults (where discarding a draft goes back to when nothing is published). */
  defaults: XeroSetupState;
  /** The accounts consl created in this Xero organisation (reusable by name). */
  conslMade: string[];
  savedAt: string | null;
  draftSavedAt: string | null;
  /** Accounts the setup names that are gone from Xero (archived or deleted there). */
  stale: string[];
  /** Some Shopify orders were paid with regular PayPal (into the merchant's PayPal balance). */
  regularPaypal: boolean;
};

export type XeroSetupLoad =
  | XeroSetupScreen
  | { state: "not_connected" }
  | { state: "reconnect"; orgName: string | null; message: string }
  | { state: "error"; orgName: string | null; message: string };

const isTarget = (v: unknown): v is XeroTarget =>
  !!v && typeof v === "object" && ((v as XeroTarget).kind === "account" || (v as XeroTarget).kind === "new") && typeof (v as { name?: unknown }).name === "string";

/** A stored state (a draft, or what the screen sends), read defensively: keys it doesn't know are kept,
 *  shapes it doesn't recognise are dropped. */
function readState(raw: unknown): XeroSetupState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const targets: Record<string, XeroTarget> = {};
  for (const [k, v] of Object.entries((r.targets as Record<string, unknown>) ?? {})) if (isTarget(v)) targets[k] = v;
  const customLines: Record<string, CustomChoice> = {};
  for (const [k, v] of Object.entries((r.customLines as Record<string, unknown>) ?? {})) {
    const c = v as Partial<CustomChoice> | null;
    if (c && typeof c.account === "string") customLines[k] = { account: c.account, balance: typeof c.balance === "string" ? c.balance : "" };
  }
  return {
    targets,
    customLines,
    tagChannels: r.tagChannels !== false,
    startDate: typeof r.startDate === "string" ? r.startDate : "",
    inventoryOpening: openingChoice(r.inventoryOpening),
    sharedReceivable: r.sharedReceivable === true,
  };
}

/** A stored starting-inventory choice: "keep" only when it says so; matching consl is the default. */
function openingChoice(v: unknown): InventoryOpening {
  const c = v && typeof v === "object" ? (v as { choice?: unknown }).choice : v;
  return c === "keep" ? "keep" : "match";
}

export async function loadXeroSetup(orgId: string): Promise<XeroSetupLoad> {
  let c: Conn;
  try {
    const got = await connection(orgId);
    if (!("conn" in got)) return got;
    c = got.conn;
  } catch (e) {
    return { state: "reconnect", orgName: null, message: (e as Error).message };
  }
  try {
    const [raw, rows, saved, tz, paid] = await Promise.all([
      allAccounts(c),
      companyRows(orgId),
      prismaBase.xeroSetup.findUnique({ where: { orgId } }),
      companyZone(orgId),
      prismaBase.salesOrder.count({ where: { orgId, channel: "SHOPIFY", paymentMethod: "paypal", cancelled: false, voided: false } }),
    ]);
    const accounts = raw.filter(usable).map(option).sort(byCode);
    const live = new Map(accounts.map((a) => [a.accountId, a]));
    const conslMade = idList(saved?.createdAccountIds);
    const ours = oursByName(accounts, conslMade);
    const firstOfMonth = `${localDay(tz).slice(0, 8)}01`;

    // consl's proposal for every account: its own section accounts and every balance account.
    const defaults: Record<string, XeroTarget> = {};
    for (const k of LINE_ORDER) defaults[k] = suggest(LINES[k].suggest, ours);
    for (const b of rows.balances) defaults[b.key] = suggest(b.suggest, ours);
    defaults[INVENTORY_ADJUSTMENT_KEY] = suggest(INVENTORY_ADJUSTMENT_SUGGEST, ours);
    defaults[SHARED_RECEIVABLE_KEY] = suggest(SHARED_RECEIVABLE_SUGGEST, ours);

    const stale = new Set<string>();
    // An account gone from Xero falls back to consl's proposal (an added one: to a new account of its name).
    const settle = (targets: Record<string, XeroTarget>) => {
      const out: Record<string, XeroTarget> = { ...defaults };
      for (const [k, t] of Object.entries(targets)) {
        if (t.kind === "new") out[k] = t;
        else if (live.has(t.accountId)) out[k] = { kind: "account", ...live.get(t.accountId)! };
        else {
          stale.add(k);
          if (!defaults[k]) out[k] = { kind: "new", name: t.name, type: t.type };
        }
      }
      return out;
    };
    const lineIds = new Set(rows.lines.map((l) => l.id));
    const onlyLive = (cl: Record<string, CustomChoice>) => Object.fromEntries(Object.entries(cl).filter(([id]) => lineIds.has(id)));

    let published: XeroSetupState | null = null;
    if (saved?.savedAt) {
      const stored: Record<string, XeroTarget> = {};
      for (const [k, v] of Object.entries({ ...(saved.lines as Record<string, Stored>), ...(saved.balances as Record<string, Stored>) })) stored[k] = { kind: "account", ...v };
      // A shared receivable is stored under every channel's key: it shows as the one shared account,
      // and the per-channel cards go back to consl's proposals (for switching back).
      if (saved.sharedReceivable) {
        const first = Object.keys(stored).find(isReceivableKey);
        if (first) stored[SHARED_RECEIVABLE_KEY] = stored[first];
        for (const k of Object.keys(stored)) if (isReceivableKey(k) && k !== SHARED_RECEIVABLE_KEY) delete stored[k];
      }
      published = {
        targets: settle(stored),
        customLines: onlyLive((readState({ customLines: saved.customLines })?.customLines ?? {}) as Record<string, CustomChoice>),
        tagChannels: saved.tagChannels,
        startDate: saved.startDate ?? (saved.startMonth ? `${saved.startMonth}-01` : firstOfMonth),
        inventoryOpening: openingChoice(saved.inventoryOpening),
        sharedReceivable: saved.sharedReceivable,
      };
    }
    const draft = saved?.draft ? readState(saved.draft) : null;
    const fresh: XeroSetupState = { targets: { ...defaults }, customLines: {}, tagChannels: true, startDate: firstOfMonth, inventoryOpening: "match", sharedReceivable: false };
    const current: XeroSetupState = draft
      ? {
          targets: settle(draft.targets),
          customLines: onlyLive(draft.customLines),
          tagChannels: draft.tagChannels,
          startDate: draft.startDate || published?.startDate || firstOfMonth,
          inventoryOpening: draft.inventoryOpening,
          sharedReceivable: draft.sharedReceivable,
        }
      : (published ?? fresh);

    return {
      state: "ready",
      orgName: c.orgName,
      accounts,
      channels: rows.channels,
      lines: rows.lines,
      balances: rows.balances,
      published,
      current,
      defaults: fresh,
      conslMade,
      savedAt: saved?.savedAt?.toISOString() ?? null,
      draftSavedAt: draft ? (saved?.draftSavedAt?.toISOString() ?? null) : null,
      stale: [...stale],
      regularPaypal: paid > 0,
    };
  } catch (e) {
    return { state: "error", orgName: c.orgName, message: (e as Error).message };
  }
}

/** The chart as the setup screen lists it, read live (the screen re-reads it when you come back to it). */
export async function listUsableXeroAccounts(orgId: string): Promise<{ accounts: XeroAccountOption[]; conslMade: string[] }> {
  const got = await connection(orgId);
  if (!("conn" in got)) throw new Error(got.state === "not_connected" ? "Connect Xero first." : got.message);
  const [raw, saved] = await Promise.all([allAccounts(got.conn), prismaBase.xeroSetup.findUnique({ where: { orgId }, select: { createdAccountIds: true } })]);
  return { accounts: raw.filter(usable).map(option).sort(byCode), conslMade: idList(saved?.createdAccountIds) };
}

type ReportCell = { Value?: string; Attributes?: { Id?: string; Value?: string }[] };
type ReportRow = { RowType?: string; Cells?: ReportCell[]; Rows?: ReportRow[] };

/** Every account's balance at the end of a day, from Xero's balance sheet (standard layout,
 *  accrual), by AccountID. The first value column is the day asked for; an account with nothing in
 *  it isn't listed (its balance is 0). */
async function xeroBalancesAt(c: Conn, day: string): Promise<Map<string, number>> {
  if (DEV_FIXTURE) return new Map(Object.entries(devBalances));
  const res = await xeroApi<{ Reports?: { Rows?: ReportRow[] }[] }>(c.token, c.tenantId, `/Reports/BalanceSheet?date=${day}&standardLayout=true`);
  const out = new Map<string, number>();
  const walk = (rows: ReportRow[] | undefined) => {
    for (const r of rows ?? []) {
      const id = r.RowType === "Row" ? r.Cells?.[0]?.Attributes?.find((a) => a.Id === "account")?.Value : undefined;
      if (id) {
        const v = Number(String(r.Cells?.[1]?.Value ?? "0").replace(/,/g, ""));
        if (Number.isFinite(v)) out.set(id, v);
      }
      walk(r.Rows);
    }
  };
  walk(res.Reports?.[0]?.Rows);
  return out;
}

/** The company's own inventory accounts in Xero: Xero's Inventory type, or an asset named for stock. */
const isInventoryAccount = (a: XeroApiAccount) =>
  usable(a) && (a.Type === "INVENTORY" || (["CURRENT", "NONCURRENT"].includes(a.Type) && /inventor|stock/i.test(a.Name)));

const cents = (n: number) => Math.round(n * 100) / 100;

/** "Sep 30, 2026" for a day. */
const dayLabel = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/**
 * The two starting balances for a start date, both at the end of the day before it: consl's stock
 * value (its daily record, the dashboard's inventory value: raw materials, in production, finished
 * stock everywhere) and Xero's balance in the inventory account (nothing yet in one consl will
 * create). A day that isn't over yet has neither: both are read once it is.
 */
async function openingNumbers(c: Conn, orgId: string, startDate: string, accountId: string | null): Promise<StartingInventory> {
  const asOf = dayBefore(startDate);
  const tz = await companyZone(orgId);
  const pending = asOf >= localDay(tz);
  const [row, first] = await Promise.all([
    pending ? null : prismaBase.inventoryValueSnapshot.findFirst({ where: { orgId, day: asOf } }),
    prismaBase.inventoryValueSnapshot.findFirst({ where: { orgId }, orderBy: { day: "asc" }, select: { day: true } }),
  ]);
  const consl = row ? { total: cents(row.total), raw: cents(row.raw), inProduction: cents(row.inProduction), finished: cents(row.total - row.raw - row.inProduction) } : null;
  let xero: StartingInventory["xero"] = { balance: accountId ? null : 0, newAccount: !accountId };
  if (!pending && !c.readsBalances) xero = { balance: null, newAccount: !accountId, reconnect: true };
  else if (!pending) {
    try {
      const [balances, chart] = await Promise.all([xeroBalancesAt(c, asOf), accountId ? Promise.resolve([] as XeroApiAccount[]) : allAccounts(c)]);
      const others = chart
        .filter((a) => isInventoryAccount(a) && Math.abs(balances.get(a.AccountID) ?? 0) >= 0.005)
        .map((a) => ({ ...option(a), balance: cents(balances.get(a.AccountID)!) }));
      xero = accountId ? { balance: cents(balances.get(accountId) ?? 0), newAccount: false } : { balance: 0, newAccount: true, ...(others.length ? { others } : {}) };
    } catch (e) {
      xero = { balance: null, newAccount: !accountId, error: (e as Error).message };
    }
  }
  return { asOf, pending, consl, firstDay: first?.day ?? null, xero };
}

/** The starting balances for the setup screen (see openingNumbers). */
export async function startingInventory(orgId: string, startDate: string, accountId: string | null): Promise<StartingInventory> {
  if (!isIsoDay(startDate)) throw new Error("Pick a start date.");
  const got = await connection(orgId);
  if (!("conn" in got)) throw new Error(got.state === "not_connected" ? "Connect Xero first." : got.message);
  return openingNumbers(got.conn, orgId, startDate, accountId);
}

/** Keep the setup as a draft: consl only, nothing reaches Xero. */
export async function saveXeroDraft(orgId: string, input: XeroSetupState): Promise<{ draftSavedAt: string }> {
  const state = readState(input);
  if (!state) throw new Error("Nothing to save.");
  const at = new Date();
  const draft = JSON.parse(JSON.stringify(state)) as Prisma.InputJsonValue;
  await prismaBase.xeroSetup.upsert({ where: { orgId }, create: { orgId, draft, draftSavedAt: at }, update: { draft, draftSavedAt: at } });
  return { draftSavedAt: at.toISOString() };
}

/** Throw away the saved draft: the screen goes back to what's published. */
export async function discardXeroDraft(orgId: string): Promise<void> {
  await prismaBase.xeroSetup.updateMany({ where: { orgId }, data: { draft: Prisma.DbNull, draftSavedAt: null } });
}

/** A failed save, with the rows it had already settled (accounts created before it stopped). */
export class XeroSaveError extends Error {
  constructor(
    message: string,
    readonly settled: Record<string, XeroTarget>,
  ) {
    super(message);
  }
}

const TRACKING_NAME = "Sales channel";

type TrackingCategory = { TrackingCategoryID: string; Name: string; Status: string; Options?: { TrackingOptionID: string; Name: string; Status: string }[] };

/** The "Sales channel" tracking category with one option per channel, found or created in Xero. */
async function ensureTracking(c: Conn, channels: XeroChannel[]): Promise<{ categoryId: string; options: Record<string, string> }> {
  if (DEV_FIXTURE) return { categoryId: "dev-tracking", options: Object.fromEntries(channels.map((ch) => [ch, `dev-${ch}`])) };
  const res = await xeroApi<{ TrackingCategories?: TrackingCategory[] }>(c.token, c.tenantId, "/TrackingCategories");
  const all = res.TrackingCategories ?? [];
  let cat = all.find((t) => norm(t.Name) === norm(TRACKING_NAME) && t.Status === "ACTIVE");
  if (!cat) {
    if (all.filter((t) => t.Status === "ACTIVE").length >= 2) {
      throw new Error("Xero allows two tracking categories and both are in use. Turn off channel tags, or archive one of them in Xero.");
    }
    const made = await xeroApi<{ TrackingCategories?: TrackingCategory[] }>(c.token, c.tenantId, "/TrackingCategories", { method: "PUT", body: { Name: TRACKING_NAME } });
    cat = made.TrackingCategories?.[0];
    if (!cat) throw new Error("Xero didn't create the Sales channel tracking category.");
  }
  const options: Record<string, string> = {};
  for (const ch of channels) {
    let opt = cat.Options?.find((o) => norm(o.Name) === norm(CHANNEL_NAME[ch]) && o.Status === "ACTIVE");
    if (!opt) {
      const r = await xeroApi<{ Options?: { TrackingOptionID: string; Name: string; Status: string }[] }>(
        c.token,
        c.tenantId,
        `/TrackingCategories/${cat.TrackingCategoryID}/Options`,
        { method: "PUT", body: { Name: CHANNEL_NAME[ch] } },
      );
      opt = r.Options?.[0];
      if (!opt) throw new Error(`Xero didn't create the ${CHANNEL_NAME[ch]} tracking option.`);
    }
    options[ch] = opt.TrackingOptionID;
  }
  return { categoryId: cat.TrackingCategoryID, options };
}

/**
 * A free code in the company's own numbering: right after the accounts of the same type (or class)
 * — stepping by 10 when the chart counts in tens — and inside their block, so a new revenue account
 * in a 4000s chart becomes 4310, not 210. A chart with nothing alike gets the usual range, widened
 * to four digits when the chart uses four.
 */
export function nextCode(type: string, raw: XeroApiAccount[], used: Set<string>): string {
  const numeric = (list: XeroApiAccount[]) => list.map((a) => a.Code ?? "").filter((c) => /^\d+$/.test(c)).map(Number);
  let siblings: number[] = [];
  for (const t of CODE_FAMILY[type] ?? [type]) {
    siblings = numeric(raw.filter((a) => a.Type === t));
    if (siblings.length) break;
  }
  if (!siblings.length) siblings = numeric(raw.filter((a) => CLASS_OF[a.Type] === CLASS_OF[type] && a.Type !== "BANK"));
  const free = (n: number) => !used.has(String(n));
  if (siblings.length) {
    const max = Math.max(...siblings);
    const width = String(max).length;
    const block = 10 ** (width - 1); // 1000 in a 4-digit chart, 100 in a 3-digit one
    const blockEnd = (Math.floor(max / block) + 1) * block - 1;
    const step = siblings.every((c) => c % 10 === 0) ? 10 : 1;
    for (let n = Math.ceil((max + 1) / step) * step; n <= blockEnd; n += step) if (free(n)) return String(n);
    for (let n = max + 1; n <= blockEnd; n++) if (free(n)) return String(n);
    for (let n = Math.min(...siblings); n < max; n++) if (free(n)) return String(n);
  }
  const fourDigit = numeric(raw).filter((c) => c >= 1000).length > numeric(raw).filter((c) => c < 1000).length;
  const [from, to] = CODE_RANGE[type] ?? [1000, 9999];
  const scale = fourDigit ? 10 : 1;
  for (let n = from * scale; n <= to * scale + (scale - 1); n++) if (free(n)) return String(n);
  for (let n = 1000; n <= 9999; n++) if (free(n)) return String(n);
  throw new Error("No free account code left in Xero.");
}

/**
 * Publish the setup: it must be complete (an account behind every line that's sent; a P&L account
 * AND a balance account for every custom line placed), new accounts are created in Xero first
 * (numbered in the company's own numbering), then the setup is stored for the monthly journals and
 * the draft is cleared. Accounts nothing uses are never created. Returns the accounts created.
 */
export async function publishXeroSetup(orgId: string, raw0: XeroSetupState): Promise<{ created: { code: string; name: string }[]; targets: Record<string, XeroTarget> }> {
  const input = readState(raw0);
  if (!input) throw new Error("Nothing to publish.");
  if (!isIsoDay(input.startDate)) throw new Error("Pick the day to start sending from.");
  const got = await connection(orgId);
  if (!("conn" in got)) throw new Error(got.state === "not_connected" ? "Connect Xero first." : got.message);
  const c = got.conn;

  const [raw, rows, saved] = await Promise.all([allAccounts(c), companyRows(orgId), prismaBase.xeroSetup.findUnique({ where: { orgId }, select: { createdAccountIds: true } })]);
  const byLine = new Map(rows.lines.map((l) => [l.id, l]));
  // With one receivable for every channel, each channel's receivable key (and a custom line's) is
  // the shared account.
  const shared = input.sharedReceivable === true;
  const targetOf = (k: string): XeroTarget | undefined => (shared && isReceivableKey(k) ? input.targets[SHARED_RECEIVABLE_KEY] : input.targets[k]);
  // A custom line sent to a receivable keeps its own channel's key (the shared account when shared).
  const custom: Record<string, CustomChoice> = Object.fromEntries(
    Object.entries(input.customLines)
      .filter(([id]) => byLine.has(id))
      .map(([id, c]) => [id, shared && isReceivableKey(c.balance) ? { ...c, balance: `receivable:${byLine.get(id)!.channel}` } : c]),
  );
  const plKeys = new Set<string>();
  const balanceKeys = new Set<string>(rows.balances.map((b) => b.key));
  for (const l of rows.lines) {
    const k = l.custom ? null : lockedAccountOf(l);
    if (k) plKeys.add(k);
  }
  for (const [id, choice] of Object.entries(custom)) {
    if (!choice.account || !choice.balance) throw new Error("Pick a P&L account and a balance account for every custom line you send to Xero.");
    plKeys.add(choice.account);
    balanceKeys.add(choice.balance);
    const t = input.targets[choice.account];
    if (t && CLASS_OF_TYPE[t.type] !== customClass(byLine.get(id)!)) throw new Error(`${byLine.get(id)!.line} needs ${customClass(byLine.get(id)!) === "income" ? "an income" : "a cost"} account.`);
  }
  // Starting inventory: matching consl's value needs consl's value for the day before the start
  // date, and an account for the difference. What's stored here is a preview: the first journal
  // reads both numbers again when it's sent, in case either changed.
  let opening: Prisma.InputJsonValue = { choice: "keep" };
  if (input.inventoryOpening !== "keep") {
    const inv = input.targets.inventory;
    const s = await openingNumbers(c, orgId, input.startDate, inv?.kind === "account" ? inv.accountId : null);
    if (s.xero.reconnect) {
      throw new Error("To match consl's value, reconnect Xero first so consl can read your inventory there (or keep Xero's inventory number).");
    }
    if (!s.pending && !s.consl) {
      throw new Error(
        `consl has no stock value for ${dayLabel(s.asOf)}${s.firstDay && s.firstDay > s.asOf ? ` (its stock history starts ${dayLabel(s.firstDay)})` : ""}. Pick a later start date, or keep Xero's inventory number.`,
      );
    }
    // A new inventory account starts empty; only an existing one needs its balance read.
    if (s.xero.error && !s.xero.newAccount) throw new Error(`Couldn't read your inventory balance in Xero: ${s.xero.error}`);
    plKeys.add(INVENTORY_ADJUSTMENT_KEY);
    opening = {
      choice: "match",
      asOf: s.asOf,
      account: INVENTORY_ADJUSTMENT_KEY,
      ...(s.consl && s.xero.balance !== null ? { conslValue: s.consl.total, xeroBalance: s.xero.balance, difference: cents(s.consl.total - s.xero.balance) } : {}),
      checkedAt: new Date().toISOString(),
    };
  }
  const keys = [...plKeys, ...balanceKeys];
  if (keys.some((k) => !targetOf(k))) throw new Error("Pick an account for every line before publishing.");
  // Each account keeps its kind: an income account for income, a cost account for costs, and a
  // balance account on the balance sheet.
  const wrong = (k: string, want: string[]) => !want.includes(CLASS_OF_TYPE[targetOf(k)!.type] ?? "");
  for (const k of plKeys) {
    const own = (LINE_ORDER as string[]).includes(k) ? [CLASS_OF_TYPE[LINES[k as keyof typeof LINES].suggest.type]] : ["income", "cost"];
    if (wrong(k, own)) throw new Error(`${targetOf(k)!.name} is the wrong kind of account for its lines. Pick ${own[0] === "income" ? "an income" : "a cost"} account.`);
  }
  for (const k of balanceKeys) if (wrong(k, ["asset", "liability"])) throw new Error(`${targetOf(k)!.name} isn't a balance sheet account. Pick an asset or liability account.`);

  const used = new Set(raw.map((a) => a.Code).filter((code): code is string => Boolean(code)));
  const live = new Map(raw.filter(usable).map((a) => [a.AccountID, option(a)]));
  const conslMade = new Set(idList(saved?.createdAccountIds));
  const made = new Map<string, Stored>(); // by name: this save's new accounts
  const created: { code: string; name: string }[] = [];

  const resolve = async (t: XeroTarget): Promise<Stored> => {
    if (t.kind === "account") {
      const acc = live.get(t.accountId);
      if (!acc) throw new Error(`${t.code ? `${t.code} ` : ""}${t.name} is no longer available in Xero. Pick another account.`);
      return acc;
    }
    const name = t.name.trim();
    if (!name || !CLASS_OF[t.type]) throw new Error("A new account is missing its name or type.");
    if (name.length > 150) throw new Error(`"${name.slice(0, 40)}…" is too long for a Xero account name (150 characters at most).`);
    const key = norm(name);
    const done = made.get(key);
    if (done) {
      if (done.type !== t.type) throw new Error(`Two new accounts are both called "${name}". Give one of them another name.`);
      return done;
    }
    // Xero names are unique. consl's own account under this name (a retry) is reused; anyone
    // else's is refused, so a "new" account never lands on one of the company's accounts.
    const same = raw.filter((a) => norm(a.Name) === norm(name));
    const ours = same.find((a) => conslMade.has(a.AccountID) && usable(a));
    if (ours) {
      const acc = option(ours);
      made.set(key, acc);
      return acc;
    }
    if (same.length) {
      const archived = same.every((a) => a.Status !== "ACTIVE");
      throw new Error(
        archived
          ? `"${name}" is the name of an archived account in Xero. Give the new account another name.`
          : `"${name}" is already an account in Xero. Pick it from the list, or give the new account another name.`,
      );
    }
    const code = nextCode(t.type, raw, used);
    used.add(code);
    let acc: Stored;
    if (DEV_FIXTURE) {
      const fake = { AccountID: `dev-new-${code}`, Code: code, Name: name, Type: t.type, Status: "ACTIVE" };
      devAccounts.push(fake);
      acc = option(fake);
    } else {
      const res = await xeroApi<{ Accounts?: XeroApiAccount[] }>(c.token, c.tenantId, "/Accounts", { method: "PUT", body: { Code: code, Name: name, Type: t.type } });
      const a = res.Accounts?.[0];
      if (!a) throw new Error(`Xero didn't create ${name}.`);
      acc = option(a);
    }
    made.set(key, acc);
    created.push({ code: acc.code, name: acc.name });
    console.log(`[xero] org ${orgId}: created account ${acc.code} ${acc.name} (${acc.type})`);
    // Recorded at once, so a retry after a later failure knows this account is consl's. Best
    // effort: the final save records the full list again.
    conslMade.add(acc.accountId);
    const createdAccountIds = [...conslMade];
    await prismaBase.xeroSetup
      .upsert({ where: { orgId }, create: { orgId, createdAccountIds }, update: { createdAccountIds } })
      .catch((e) => console.error(`[xero] org ${orgId}: couldn't record created account ${acc.accountId}:`, (e as Error).message));
    return acc;
  };

  const lines: Record<string, Stored> = {};
  const balances: Record<string, Stored> = {};
  try {
    for (const k of plKeys) lines[k] = await resolve(targetOf(k)!);
    for (const k of balanceKeys) balances[k] = await resolve(targetOf(k)!);
    const tracking = input.tagChannels && rows.channels.length > 0 ? await ensureTracking(c, rows.channels) : null;

    const data = {
      lines,
      balances,
      customLines: custom,
      sameForAllChannels: true,
      tagChannels: input.tagChannels,
      trackingCategoryId: tracking?.categoryId ?? null,
      trackingOptions: tracking?.options ?? {},
      startDate: input.startDate,
      inventoryOpening: opening,
      sharedReceivable: shared,
      createdAccountIds: [...conslMade],
      savedAt: new Date(),
      draft: Prisma.DbNull,
      draftSavedAt: null,
    };
    await prismaBase.xeroSetup.upsert({ where: { orgId }, create: { orgId, ...data }, update: data });
  } catch (e) {
    throw new XeroSaveError((e as Error).message, settledTargets(lines, balances, shared));
  }
  console.log(`[xero] org ${orgId}: export setup published (${keys.length} accounts, ${Object.keys(custom).length} custom lines, ${created.length} accounts created${shared ? ", one receivable for every channel" : ""})`);
  return { created, targets: settledTargets(lines, balances, shared) };
}

/** The accounts a publish settled, as the screen holds them: with one receivable for every channel,
 *  that account goes back under the shared key and the per-channel cards keep their own picks. */
function settledTargets(lines: Record<string, Stored>, balances: Record<string, Stored>, shared: boolean): Record<string, XeroTarget> {
  const out: Record<string, XeroTarget> = {};
  for (const [k, v] of Object.entries({ ...lines, ...balances })) {
    if (shared && isReceivableKey(k)) out[SHARED_RECEIVABLE_KEY] = { kind: "account", ...v };
    else out[k] = { kind: "account", ...v };
  }
  return out;
}

/** For the P&L's Xero button: connected or not, and whether the setup has been saved. */
export async function xeroExportStatus(orgId: string): Promise<"not_connected" | "reconnect" | "setup" | "ready"> {
  const [row, setup] = await Promise.all([
    prismaBase.integration.findUnique({ where: { orgId_provider: { orgId, provider: "xero" } }, select: { status: true, refreshTokenEnc: true } }),
    prismaBase.xeroSetup.findUnique({ where: { orgId }, select: { savedAt: true } }),
  ]);
  if (DEV_FIXTURE) return setup?.savedAt ? "ready" : "setup";
  if (!row || !row.refreshTokenEnc || row.status === "revoked" || row.status === "choose") return "not_connected";
  if (row.status === "error") return "reconnect";
  return setup?.savedAt ? "ready" : "setup";
}
