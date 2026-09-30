import "server-only";
import { prismaBase } from "@/lib/prisma-base";
import { xeroAccessToken, xeroApi } from "@/lib/xero";
import { devAccounts, devFixture, type FixtureAccount } from "@/lib/xero-dev-fixture";
import { localDay } from "@/lib/tz";
import {
  CHANNEL_NAME,
  CHANNEL_ORDER,
  LINES,
  LINE_ORDER,
  isIsoDay,
  lineRowKey,
  newAccountName,
  type BalanceRow,
  type LineKey,
  type Suggestion,
  type XeroAccountOption,
  type XeroChannel,
  type XeroTarget,
} from "@/lib/xero-setup-shared";

/**
 * The Xero export's setup (the account behind every P&L line and balance row) — loaded for the
 * setup screen and saved from it. Reading never changes anything in Xero; saving creates the new
 * accounts the owner accepted, the "Sales channel" tracking category when channel tags are on, and
 * stores the choices. Journals come later and read the stored setup.
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

type Conn = { token: string; tenantId: string; orgName: string };

async function connection(orgId: string): Promise<{ conn: Conn } | { state: "not_connected" } | { state: "reconnect"; orgName: string | null; message: string }> {
  if (DEV_FIXTURE) return { conn: { token: "dev", tenantId: "dev", orgName: devFixture.orgName } };
  const row = await prismaBase.integration.findUnique({ where: { orgId_provider: { orgId, provider: "xero" } } });
  if (!row || !row.refreshTokenEnc || row.status === "revoked" || row.status === "choose") return { state: "not_connected" };
  if (row.status === "error" || !row.sellerId) {
    return { state: "reconnect", orgName: row.accountName, message: "consl's access to Xero ended. Reconnect Xero to continue." };
  }
  const token = await xeroAccessToken(row);
  return { conn: { token, tenantId: row.sellerId, orgName: row.accountName ?? "your Xero organisation" } };
}

async function allAccounts(c: Conn): Promise<XeroApiAccount[]> {
  if (DEV_FIXTURE) return devAccounts;
  const res = await xeroApi<{ Accounts?: XeroApiAccount[] }>(c.token, c.tenantId, "/Accounts");
  return res.Accounts ?? [];
}

/** The rows this company's P&L has: its lines per channel, and the balance rows they need. */
async function companyRows(orgId: string) {
  const [groups, stock, fees, metaAccounts, adsConn] = await Promise.all([
    prismaBase.financeEvent.groupBy({ by: ["channel", "group"], where: { orgId } }),
    prismaBase.stockEvent.groupBy({ by: ["channel"], where: { orgId } }),
    prismaBase.$queryRaw<{ channel: string; bucket: string; type: string }[]>`
      SELECT DISTINCT s.channel, f.bucket, f.type FROM "OrderFee" f JOIN "SalesOrder" s ON s.id = f."orderId" WHERE f."orgId" = ${orgId}`,
    prismaBase.metaAdAccount.count({ where: { orgId } }),
    prismaBase.integration.findUnique({ where: { orgId_provider: { orgId, provider: "amazon_ads" } }, select: { id: true } }),
  ]);
  const isChannel = (c: string): c is XeroChannel => (CHANNEL_ORDER as string[]).includes(c);
  const found = new Map<XeroChannel, Set<LineKey>>();
  const add = (channel: string, line: LineKey) => {
    if (!isChannel(channel)) return;
    if (!found.has(channel)) found.set(channel, new Set());
    found.get(channel)!.add(line);
  };
  for (const g of groups) if ((LINE_ORDER as string[]).includes(g.group)) add(g.channel, g.group as LineKey);
  for (const f of fees) add(f.channel, f.type === "credit" && f.bucket === "sales" ? "sales" : f.bucket === "payment_fees" ? "payment_fees" : "custom_fees");
  for (const [channel, set] of found) if (set.has("sales")) add(channel, "cogs");
  for (const s of stock) add(s.channel, "removals");

  const channels = CHANNEL_ORDER.filter((c) => found.has(c));
  const lines = channels.flatMap((channel) => LINE_ORDER.filter((l) => found.get(channel)!.has(l)).map((line) => ({ channel, line })));

  const balances: BalanceRow[] = channels.map((channel) => ({
    key: `clearing:${channel}`,
    channel,
    label: `${CHANNEL_NAME[channel]} clearing`,
    hint: `What ${CHANNEL_NAME[channel]} owes you. Code its payout deposits here.`,
    suggest: { name: `${CHANNEL_NAME[channel]} Clearing`, type: "CURRENT" },
  }));
  // The P&L's Taxes row is the state's money, not income: it waits here until it's paid over.
  if (groups.some((g) => g.group === "taxes" && isChannel(g.channel))) {
    balances.push({
      key: "sales_tax",
      label: "Sales tax payable",
      hint: "Tax your customers paid, until it's paid to the state. Amazon and TikTok pay it for you, so theirs goes straight back out.",
      suggest: { name: "Sales Tax Payable", type: "CURRLIAB" },
    });
  }
  if (metaAccounts > 0) {
    balances.push({ key: "payable:META_ADS", label: "Meta Ads payable", hint: "Meta ad spend as it happens. Code the card charges from Meta here.", suggest: { name: "Meta Ads Payable", type: "CURRLIAB" } });
  }
  if (adsConn) {
    balances.push({ key: "payable:AMAZON_ADS", label: "Amazon Ads payable", hint: "Amazon ad invoices paid by card. Code those card charges here.", suggest: { name: "Amazon Ads Payable", type: "CURRLIAB" } });
  }
  balances.push({
    key: "inventory",
    label: "Inventory",
    hint: "Your stock at landed cost. Book stock purchases here in Xero; cost of goods leaves it each month.",
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
  lines: { channel: XeroChannel; line: LineKey }[];
  balances: BalanceRow[];
  targets: Record<string, XeroTarget>;
  sameForAllChannels: boolean;
  tagChannels: boolean;
  /** The first day sent to Xero ("YYYY-MM-DD", the company's calendar). */
  startDate: string;
  /** The accounts consl created in this Xero organisation (reusable by name). */
  conslMade: string[];
  savedAt: string | null;
  /** Rows whose saved account is gone from Xero (archived or deleted there). */
  stale: string[];
};

export type XeroSetupLoad =
  | XeroSetupScreen
  | { state: "not_connected" }
  | { state: "reconnect"; orgName: string | null; message: string }
  | { state: "error"; orgName: string | null; message: string };

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
    const [raw, rows, saved, tz] = await Promise.all([allAccounts(c), companyRows(orgId), prismaBase.xeroSetup.findUnique({ where: { orgId } }), companyZone(orgId)]);
    const accounts = raw.filter(usable).map(option).sort(byCode);
    const live = new Map(accounts.map((a) => [a.accountId, a]));
    const storedLines = (saved?.lines ?? {}) as Record<string, Stored>;
    const storedBalances = (saved?.balances ?? {}) as Record<string, Stored>;
    const conslMade = idList(saved?.createdAccountIds);
    const ours = oursByName(accounts, conslMade);
    const today = localDay(tz);

    const targets: Record<string, XeroTarget> = {};
    const stale: string[] = [];
    const pick = (key: string, stored: Stored | undefined, s: Suggestion) => {
      const acc = stored ? live.get(stored.accountId) : undefined;
      if (acc) targets[key] = { kind: "account", ...acc };
      else {
        if (stored) stale.push(key);
        targets[key] = suggest(s, ours);
      }
    };
    for (const { channel, line } of rows.lines) pick(lineRowKey(channel, line), storedLines[lineRowKey(channel, line)], LINES[line].suggest);
    for (const b of rows.balances) pick(b.key, storedBalances[b.key], b.suggest);

    return {
      state: "ready",
      orgName: c.orgName,
      accounts,
      channels: rows.channels,
      lines: rows.lines,
      balances: rows.balances,
      targets,
      sameForAllChannels: saved?.sameForAllChannels ?? true,
      tagChannels: saved?.tagChannels ?? true,
      // Not saved yet: the 1st of this month. (Setups saved before start dates had a month.)
      startDate: saved?.startDate ?? (saved?.startMonth ? `${saved.startMonth}-01` : `${today.slice(0, 8)}01`),
      conslMade,
      savedAt: saved?.savedAt?.toISOString() ?? null,
      stale,
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

export type XeroSetupInput = {
  targets: Record<string, XeroTarget>;
  sameForAllChannels: boolean;
  tagChannels: boolean;
  startDate: string;
};

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
 * Save the setup: every row needs an account; new ones are created in Xero first (numbered in
 * the company's own numbering), then the choices are stored. Returns the accounts created.
 */
export async function saveXeroSetup(orgId: string, input: XeroSetupInput): Promise<{ created: { code: string; name: string }[]; targets: Record<string, XeroTarget> }> {
  if (!isIsoDay(input.startDate)) throw new Error("Pick the day to start sending from.");
  const got = await connection(orgId);
  if (!("conn" in got)) throw new Error(got.state === "not_connected" ? "Connect Xero first." : got.message);
  const c = got.conn;

  const [raw, rows, saved] = await Promise.all([allAccounts(c), companyRows(orgId), prismaBase.xeroSetup.findUnique({ where: { orgId }, select: { createdAccountIds: true } })]);
  const keys = [...rows.lines.map((l) => lineRowKey(l.channel, l.line)), ...rows.balances.map((b) => b.key)];
  const missing = keys.filter((k) => !input.targets[k]);
  if (missing.length) throw new Error("Pick an account for every line before saving.");

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
    for (const l of rows.lines) {
      const k = lineRowKey(l.channel, l.line);
      lines[k] = await resolve(input.targets[k]);
    }
    for (const b of rows.balances) balances[b.key] = await resolve(input.targets[b.key]);
    const tracking = input.tagChannels && rows.channels.length > 0 ? await ensureTracking(c, rows.channels) : null;

    const data = {
      lines,
      balances,
      sameForAllChannels: input.sameForAllChannels,
      tagChannels: input.tagChannels,
      trackingCategoryId: tracking?.categoryId ?? null,
      trackingOptions: tracking?.options ?? {},
      startDate: input.startDate,
      createdAccountIds: [...conslMade],
      savedAt: new Date(),
    };
    await prismaBase.xeroSetup.upsert({ where: { orgId }, create: { orgId, ...data }, update: data });
  } catch (e) {
    const settled: Record<string, XeroTarget> = {};
    for (const [k, v] of Object.entries({ ...lines, ...balances })) settled[k] = { kind: "account", ...v };
    throw new XeroSaveError((e as Error).message, settled);
  }
  console.log(`[xero] org ${orgId}: export setup saved (${keys.length} rows, ${created.length} accounts created)`);
  const targets: Record<string, XeroTarget> = {};
  for (const [k, v] of Object.entries({ ...lines, ...balances })) targets[k] = { kind: "account", ...v };
  return { created, targets };
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
