import "server-only";
import { prismaBase } from "@/lib/prisma-base";
import { xeroAccessToken, xeroApi } from "@/lib/xero";
import { devAccounts, devFixture, type FixtureAccount } from "@/lib/xero-dev-fixture";
import {
  CHANNEL_NAME,
  CHANNEL_ORDER,
  LINES,
  LINE_ORDER,
  lineRowKey,
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
  const [groups, fees, first, metaAccounts, adsConn] = await Promise.all([
    prismaBase.financeEvent.groupBy({ by: ["channel", "group"], where: { orgId } }),
    prismaBase.$queryRaw<{ channel: string; bucket: string; type: string }[]>`
      SELECT DISTINCT s.channel, f.bucket, f.type FROM "OrderFee" f JOIN "SalesOrder" s ON s.id = f."orderId" WHERE f."orgId" = ${orgId}`,
    prismaBase.financeEvent.aggregate({ where: { orgId }, _min: { eventAt: true } }),
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

  const channels = CHANNEL_ORDER.filter((c) => found.has(c));
  const lines = channels.flatMap((channel) => LINE_ORDER.filter((l) => found.get(channel)!.has(l)).map((line) => ({ channel, line })));

  const balances: BalanceRow[] = channels.map((channel) => ({
    key: `clearing:${channel}`,
    channel,
    label: `${CHANNEL_NAME[channel]} clearing`,
    hint: `What ${CHANNEL_NAME[channel]} owes you. Code its payout deposits here.`,
    suggest: { names: [`${CHANNEL_NAME[channel]} Clearing`, `${CHANNEL_NAME[channel]} Receivable`], type: "CURRENT" },
  }));
  if (metaAccounts > 0) {
    balances.push({ key: "payable:META_ADS", label: "Meta Ads payable", hint: "Meta ad spend as it happens. Code the card charges from Meta here.", suggest: { names: ["Meta Ads Payable", "Facebook Ads Payable"], type: "CURRLIAB" } });
  }
  if (adsConn) {
    balances.push({ key: "payable:AMAZON_ADS", label: "Amazon Ads payable", hint: "Amazon ad invoices paid by card. Code those card charges here.", suggest: { names: ["Amazon Ads Payable"], type: "CURRLIAB" } });
  }
  if (fees.length > 0) {
    balances.push({ key: "payable:CUSTOM_FEES", label: "Custom fees payable", hint: "Fees and credits you add to orders in consl. Code their payments here.", suggest: { names: ["Custom Fees Payable"], type: "CURRLIAB" } });
  }
  balances.push({
    key: "inventory",
    label: "Inventory",
    hint: "Your stock at landed cost. Book stock purchases here in Xero; cost of goods leaves it each month.",
    suggest: { names: ["Inventory", "Inventory Asset", "Stock on Hand"], type: "INVENTORY" },
  });

  return { channels, lines, balances, firstEvent: first._min.eventAt };
}

/** An account already in Xero under one of the suggested names (same class), else a new one. */
function suggest(s: Suggestion, accounts: XeroAccountOption[]): XeroTarget {
  for (const name of s.names) {
    const hit = accounts.find((a) => norm(a.name) === norm(name) && CLASS_OF[a.type] === CLASS_OF[s.type]);
    if (hit) return { kind: "account", ...hit };
  }
  return { kind: "new", name: s.names[0], type: s.type };
}

const monthLabel = (ym: string) => new Date(`${ym}-01T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const thisMonth = () => new Date().toISOString().slice(0, 7);

/** Every month from the company's first money event to now, newest first. */
function monthsSince(first: Date | null): { value: string; label: string }[] {
  const end = thisMonth();
  let ym = first ? first.toISOString().slice(0, 7) : end;
  const out: string[] = [];
  while (ym <= end && out.length < 120) {
    out.push(ym);
    const [y, m] = ym.split("-").map(Number);
    ym = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  }
  return out.reverse().map((value) => ({ value, label: monthLabel(value) }));
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
  startMonth: string;
  months: { value: string; label: string }[];
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
    const [raw, rows, saved] = await Promise.all([allAccounts(c), companyRows(orgId), prismaBase.xeroSetup.findUnique({ where: { orgId } })]);
    const accounts = raw.filter(usable).map(option).sort(byCode);
    const live = new Map(accounts.map((a) => [a.accountId, a]));
    const storedLines = (saved?.lines ?? {}) as Record<string, Stored>;
    const storedBalances = (saved?.balances ?? {}) as Record<string, Stored>;

    const targets: Record<string, XeroTarget> = {};
    const stale: string[] = [];
    const pick = (key: string, stored: Stored | undefined, s: Suggestion) => {
      const acc = stored ? live.get(stored.accountId) : undefined;
      if (acc) targets[key] = { kind: "account", ...acc };
      else {
        if (stored) stale.push(key);
        targets[key] = suggest(s, accounts);
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
      startMonth: saved?.startMonth ?? thisMonth(),
      months: monthsSince(rows.firstEvent),
      savedAt: saved?.savedAt?.toISOString() ?? null,
      stale,
    };
  } catch (e) {
    return { state: "error", orgName: c.orgName, message: (e as Error).message };
  }
}

export type XeroSetupInput = {
  targets: Record<string, XeroTarget>;
  sameForAllChannels: boolean;
  tagChannels: boolean;
  startMonth: string;
};

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

function nextCode(type: string, used: Set<string>): string {
  const [from, to] = CODE_RANGE[type] ?? [1000, 9999];
  for (let n = from; n <= to; n++) if (!used.has(String(n))) return String(n);
  for (let n = 1000; n <= 9999; n++) if (!used.has(String(n))) return String(n);
  throw new Error("No free account code left in Xero.");
}

/**
 * Save the setup: every row needs an account; new ones are created in Xero first (numbered in
 * the usual range for their type), then the choices are stored. Returns the accounts created.
 */
export async function saveXeroSetup(orgId: string, input: XeroSetupInput): Promise<{ created: { code: string; name: string }[]; targets: Record<string, XeroTarget> }> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.startMonth)) throw new Error("Pick the first month to send.");
  const got = await connection(orgId);
  if (!("conn" in got)) throw new Error(got.state === "not_connected" ? "Connect Xero first." : got.message);
  const c = got.conn;

  const [raw, rows] = await Promise.all([allAccounts(c), companyRows(orgId)]);
  const keys = [...rows.lines.map((l) => lineRowKey(l.channel, l.line)), ...rows.balances.map((b) => b.key)];
  const missing = keys.filter((k) => !input.targets[k]);
  if (missing.length) throw new Error("Pick an account for every line before saving.");

  const used = new Set(raw.map((a) => a.Code).filter((code): code is string => Boolean(code)));
  const live = new Map(raw.filter(usable).map((a) => [a.AccountID, option(a)]));
  const made = new Map<string, Stored>();
  const created: { code: string; name: string }[] = [];

  const resolve = async (t: XeroTarget): Promise<Stored> => {
    if (t.kind === "account") {
      const acc = live.get(t.accountId);
      if (!acc) throw new Error(`${t.code ? `${t.code} ` : ""}${t.name} is no longer available in Xero. Pick another account.`);
      return acc;
    }
    const name = t.name.trim();
    if (!name || !CLASS_OF[t.type]) throw new Error("A new account is missing its name or type.");
    const key = `${t.type}|${norm(name)}`;
    const done = made.get(key);
    if (done) return done;
    // Already in Xero under that name (created elsewhere since the screen loaded): use it.
    const existing = raw.find((a) => norm(a.Name) === norm(name) && usable(a));
    if (existing) {
      const acc = option(existing);
      made.set(key, acc);
      return acc;
    }
    const code = nextCode(t.type, used);
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
    return acc;
  };

  const lines: Record<string, Stored> = {};
  for (const l of rows.lines) {
    const k = lineRowKey(l.channel, l.line);
    lines[k] = await resolve(input.targets[k]);
  }
  const balances: Record<string, Stored> = {};
  for (const b of rows.balances) balances[b.key] = await resolve(input.targets[b.key]);

  const tracking = input.tagChannels && rows.channels.length > 0 ? await ensureTracking(c, rows.channels) : null;

  const data = {
    lines,
    balances,
    sameForAllChannels: input.sameForAllChannels,
    tagChannels: input.tagChannels,
    trackingCategoryId: tracking?.categoryId ?? null,
    trackingOptions: tracking?.options ?? {},
    startMonth: input.startMonth,
    savedAt: new Date(),
  };
  await prismaBase.xeroSetup.upsert({ where: { orgId }, create: { orgId, ...data }, update: data });
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
