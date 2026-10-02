"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { SelectMenu, type SelectMenuOption } from "@/components/SelectMenu";
import { DatePicker } from "@/components/DatePicker";
import { HoverHint } from "@/components/HoverHint";
import { useMoney } from "@/components/CurrencyProvider";
import { AlertTriangle, ArrowRight, Check, GripVertical, Info, Lock, Pencil, Plus, RefreshCw, Trash2, X } from "@/components/icons";
import { SOURCE_LOGO } from "@/lib/channel-logos";
import { GROUP_LABEL } from "@/lib/pnl-shared";
import { discardXeroDraftAction, publishXeroSetupAction, saveXeroDraftAction } from "@/app/(app)/pnl/xero/actions";
import type { XeroSetupScreen } from "@/lib/xero-setup";
import {
  CHANNEL_NAME,
  CLASS_OF_TYPE,
  INVENTORY_ADJUSTMENT_KEY,
  INVENTORY_ADJUSTMENT_SUGGEST,
  LINES,
  LINE_ORDER,
  SHARED_RECEIVABLE_KEY,
  SHARED_RECEIVABLE_SUGGEST,
  isReceivableKey,
  NEW_BALANCE_TYPES,
  NEW_PL_TYPES,
  PAYPAL_STANDARD_FEE,
  XERO_TYPE_LABEL,
  balancesOf,
  customClass,
  dayBefore,
  isAddedAccount,
  isAddedBalance,
  lockedAccountOf,
  monthEnd,
  NEW_ACCOUNT_PREFIX,
  newAccountName,
  targetValue,
  type AccountClass,
  type LineKey,
  type SetupLine,
  type StartingInventory,
  type XeroAccountOption,
  type XeroChannel,
  type XeroSetupState,
  type XeroTarget,
} from "@/lib/xero-setup-shared";

const norm = (s: string) => s.trim().toLowerCase();
const PILL = "inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-1.5 py-[1px] text-[10.5px] font-medium";
/** The channel a line is tagged to in Xero, in that channel's colour. */
const CHANNEL_PILL: Record<XeroChannel, string> = { AMAZON: "pill-amber", SHOPIFY: "pill-green", TIKTOK: "pill-pink" };
/** Where a line's money came through (its sources), as the P&L marks it: a fee or credit added in consl wears consl's mark. */
const SOURCE_MARK: Record<string, { src: string; title: string }> = {
  AMAZON: { src: SOURCE_LOGO.AMAZON, title: "Amazon" },
  AMAZON_ADS: { src: SOURCE_LOGO.AMAZON_ADS, title: "Amazon Ads" },
  META: { src: SOURCE_LOGO.META, title: "Meta" },
  SHOPIFY: { src: SOURCE_LOGO.SHOPIFY, title: "Shopify" },
  TIKTOK: { src: SOURCE_LOGO.TIKTOK, title: "TikTok" },
  CONSL: { src: SOURCE_LOGO.CONSL, title: "consl" },
  CUSTOM: { src: SOURCE_LOGO.CONSL, title: "Added in consl" },
};
const marksOf = (l: SetupLine) =>
  l.sources.map((x) => SOURCE_MARK[x]).filter((m, i, all): m is { src: string; title: string } => !!m && all.findIndex((o) => o?.src === m.src) === i);
/** An account's name in a formula: without consl's prefix, which every new account carries. */
const plainName = (name: string) => (name.startsWith(NEW_ACCOUNT_PREFIX) ? name.slice(NEW_ACCOUNT_PREFIX.length) : name);
/** Re-read the Xero chart when the tab comes back into view, at most this often. */
const REFRESH_EVERY_MS = 20_000;
const NEW_OPTION = "__new";

const snapshot = (s: XeroSetupState) =>
  JSON.stringify({
    t: Object.entries(s.targets).map(([k, v]) => [k, targetValue(v)]).sort(),
    c: Object.entries(s.customLines).map(([k, v]) => [k, v.account, v.balance]).sort(),
    tag: s.tagChannels,
    start: s.startDate,
    inv: s.inventoryOpening ?? "match",
    shared: !!s.sharedReceivable,
  });

const plClass = (key: string, targets: Record<string, XeroTarget>): AccountClass =>
  (LINE_ORDER as string[]).includes(key) ? CLASS_OF_TYPE[LINES[key as LineKey].suggest.type] : (CLASS_OF_TYPE[targets[key]?.type] ?? "cost");

const shortKey = () => Math.random().toString(36).slice(2, 8);

/**
 * The Xero export's setup screen. Every line of the company's consl P&L sits under the Xero
 * account it posts to: platform lines are locked to consl's account for their P&L section (the
 * owner picks which Xero account that is, or renames consl's new one); lines added in consl
 * (custom fees and credits) start out of Xero and go in only when placed in an account, with a
 * balance account picked for them. Each balance account shows how its number is made. Changes are
 * staged: Cancel undoes them, Save keeps a draft in consl, and only Publish reaches Xero.
 */
export function XeroSetupClient({ data, canEdit }: { data: XeroSetupScreen; canEdit: boolean }) {
  const router = useRouter();
  const { money, locale } = useMoney();
  const [state, setState] = useState<XeroSetupState>(data.current);
  const [saved, setSaved] = useState<XeroSetupState>(data.current);
  const [published, setPublished] = useState<XeroSetupState | null>(data.published);
  const [draftAt, setDraftAt] = useState<string | null>(data.draftSavedAt);
  const [savedAt, setSavedAt] = useState<string | null>(data.savedAt);
  const [accounts, setAccounts] = useState<XeroAccountOption[]>(data.accounts);
  const [conslMade, setConslMade] = useState<string[]>(data.conslMade);
  const [refreshing, setRefreshing] = useState(false);
  const [pending, setPending] = useState<null | "save" | "publish" | "discard">(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [adding, setAdding] = useState<null | { kind: "pl" | "balance"; line?: string; cls?: AccountClass }>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const lastRead = useRef(0);
  const [opening, setOpening] = useState<{ key: string; data: StartingInventory | null; error: string | null } | null>(null);
  const busy = pending !== null;
  const editable = canEdit && !busy;

  const existingByName = useMemo(() => new Map(accounts.map((a) => [norm(a.name), a])), [accounts]);
  // A "new" account named like one consl already made in this Xero organisation IS that account
  // (a publish that stopped halfway made it): the row shows it, and publishing reuses it.
  const targets = useMemo(() => {
    const ours = new Set(conslMade);
    const out: Record<string, XeroTarget> = {};
    for (const [k, t] of Object.entries(state.targets)) {
      const acc = t.kind === "new" ? existingByName.get(norm(t.name)) : undefined;
      out[k] = acc && ours.has(acc.accountId) ? { kind: "account", ...acc } : t;
    }
    return out;
  }, [state.targets, existingByName, conslMade]);
  const clashOf = (t: XeroTarget | null | undefined) => (t?.kind === "new" ? (existingByName.get(norm(t.name)) ?? null) : null);

  const dirty = snapshot({ ...state, targets }) !== snapshot(saved);
  const unpublished = !published || snapshot(saved) !== snapshot(published);

  // The chart as Xero has it now: re-read on Refresh and whenever the tab comes back into view,
  // so an account created in Xero a moment ago can be picked (Xero has no webhook for accounts).
  const refreshAccounts = useCallback(async (quiet: boolean) => {
    lastRead.current = Date.now();
    if (!quiet) setRefreshing(true);
    try {
      const r = await fetch("/api/integrations/xero/accounts", { cache: "no-store" });
      const j = (await r.json().catch(() => null)) as { accounts?: XeroAccountOption[]; conslMade?: string[]; error?: string } | null;
      if (r.ok && j?.accounts) {
        setAccounts(j.accounts);
        if (j.conslMade) setConslMade(j.conslMade);
      } else if (!quiet) setError(j?.error ?? "Couldn't read your Xero accounts.");
    } catch {
      if (!quiet) setError("Couldn't reach Xero. Try again.");
    } finally {
      if (!quiet) setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    lastRead.current = Date.now();
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastRead.current > REFRESH_EVERY_MS) void refreshAccounts(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refreshAccounts]);

  // Starting inventory: consl's stock value and Xero's inventory balance at the end of the day
  // before the start date, read again whenever the date or the inventory account changes.
  const invTarget = targets.inventory;
  const invAccount = invTarget?.kind === "account" ? invTarget.accountId : "";
  const openingKey = `${state.startDate}|${invAccount}`;
  useEffect(() => {
    if (!state.startDate) return;
    const key = `${state.startDate}|${invAccount}`;
    const ctl = new AbortController();
    fetch(`/api/integrations/xero/starting-inventory?start=${state.startDate}${invAccount ? `&account=${encodeURIComponent(invAccount)}` : ""}`, { cache: "no-store", signal: ctl.signal })
      .then(async (r) => {
        const j = (await r.json().catch(() => null)) as (StartingInventory & { error?: string }) | null;
        setOpening(r.ok && j && !j.error ? { key, data: j, error: null } : { key, data: null, error: j?.error ?? "Couldn't read the starting balances." });
      })
      .catch(() => {
        if (!ctl.signal.aborted) setOpening({ key, data: null, error: "Couldn't reach the server." });
      });
    return () => ctl.abort();
  }, [state.startDate, invAccount]);
  const openingNow = opening?.key === openingKey ? opening : null;
  const choice = state.inventoryOpening ?? "match";
  const openingData = openingNow?.data ?? null;
  const openingDiff = openingData?.consl && openingData.xero.balance !== null ? Math.round((openingData.consl.total - openingData.xero.balance) * 100) / 100 : null;
  // Matching needs consl's value for that day (a start date before consl's stock history can't
  // match) and Xero's permission to read the balance sheet.
  const matchBlocked = choice === "match" && !!openingData && ((!openingData.pending && !openingData.consl) || !!openingData.xero.reconnect);

  const lines = data.lines;
  const byId = useMemo(() => new Map(lines.map((l) => [l.id, l])), [lines]);
  // A custom line whose account is gone (an added account removed) is simply not sent.
  const placed = useMemo(
    () => Object.fromEntries(Object.entries(state.customLines).filter(([id, c]) => byId.has(id) && !!state.targets[c.account])),
    [state.customLines, state.targets, byId],
  );
  const customLines = lines.filter((l) => l.custom);
  const excluded = customLines.filter((l) => !placed[l.id]);
  const linesOf = (key: string) => lines.filter((l) => (l.custom ? placed[l.id]?.account === key : lockedAccountOf(l) === key));

  // P&L accounts on screen: consl's section accounts that hold lines, then the ones the owner added.
  const plKeys = [
    ...LINE_ORDER.filter((k) => lines.some((l) => !l.custom && lockedAccountOf(l) === k) || Object.values(placed).some((c) => c.account === k)),
    ...Object.keys(state.targets).filter(isAddedAccount),
  ];
  // Receivables: one per channel, or (shared) one card for every channel's, where the first one was.
  const shared = !!state.sharedReceivable;
  const receivableRows = data.balances.filter((b) => isReceivableKey(b.key));
  const receivableChannels = receivableRows.map((b) => b.channel).filter((c): c is XeroChannel => !!c);
  const canShare = receivableRows.length >= 2 || shared;
  /** A balance key as the screen shows it: a channel's receivable is the shared one when shared. */
  const viewKey = (k: string) => (shared && isReceivableKey(k) ? SHARED_RECEIVABLE_KEY : k);
  const ownBalanceRows = data.balances.flatMap((b) => {
    if (shared && isReceivableKey(b.key)) {
      if (b.key !== receivableRows[0]?.key) return [];
      return [
        {
          key: SHARED_RECEIVABLE_KEY,
          label: "Sales receivable",
          hint: "What your sales channels owe you, in one account.",
          cls: "asset" as AccountClass,
          suggest: SHARED_RECEIVABLE_SUGGEST,
          channel: undefined as XeroChannel | undefined,
        },
      ];
    }
    return [{ key: b.key, label: b.label, hint: b.hint, cls: CLASS_OF_TYPE[b.suggest.type] as AccountClass, suggest: b.suggest, channel: b.channel }];
  });
  const balanceRows = [
    ...ownBalanceRows,
    ...Object.keys(state.targets)
      .filter(isAddedBalance)
      .map((key) => ({
        key,
        label: "Added by you",
        hint: "Reconcile the payments of what goes here to this account in Xero.",
        cls: (CLASS_OF_TYPE[state.targets[key].type] ?? "liability") as AccountClass,
        suggest: { name: state.targets[key].name.replace(/^consl - /, ""), type: state.targets[key].type },
        channel: undefined,
      })),
  ];

  // What the owner reconciles to each balance account in Xero, from the bank or card statement.
  const codeHereOf = (key: string, cls: AccountClass): string[] =>
    key === "receivable:AMAZON"
      ? ["Amazon payouts", "Card charges from Amazon, when your Amazon balance runs negative"]
      : key === "receivable:SHOPIFY"
        ? ["Shopify payouts", ...(data.regularPaypal ? ["PayPal transfers, for orders paid with regular PayPal (money that lands in your PayPal balance)"] : [])]
        : key === "receivable:TIKTOK"
          ? ["TikTok Shop payouts"]
          : key === "sales_tax"
            ? ["Your sales tax payments to the state"]
            : key === "payable:META_ADS"
              ? ["Card charges from Meta"]
              : key === "payable:AMAZON_ADS"
                ? ["Card charges from Amazon Ads"]
                : key === "inventory"
                  ? ["Bills for stock and everything consl counts in your product cost (materials, packaging, production, freight in). Book them here, not as an expense, or Xero counts them twice."]
                  : cls === "liability"
                    ? ["Your payments of what you send here"]
                    : ["Money you receive for what you send here"];

  // Cards that post to one Xero account (the same account picked twice, or two new accounts with
  // the same name) say so on each card, so sharing an account is never a surprise.
  const cardLabel = (key: string) =>
    key === SHARED_RECEIVABLE_KEY
      ? "Sales receivable"
      : key === INVENTORY_ADJUSTMENT_KEY
        ? "Inventory adjustment"
        : (LINE_ORDER as string[]).includes(key)
          ? `your ${LINES[key as LineKey].label.toLowerCase()}`
          : isAddedAccount(key)
            ? "an account you added"
            : isAddedBalance(key)
              ? "a balance account you added"
              : (data.balances.find((b) => b.key === key)?.label ?? key);
  const identity = (t: XeroTarget | undefined) => (!t ? null : t.kind === "account" ? `acc:${t.accountId}` : `new:${t.type}:${norm(t.name)}`);
  const byIdentity = new Map<string, string[]>();
  for (const k of [...plKeys, ...(choice === "match" ? [INVENTORY_ADJUSTMENT_KEY] : []), ...balanceRows.map((b) => b.key)]) {
    const id = identity(targets[k]);
    if (id) byIdentity.set(id, [...(byIdentity.get(id) ?? []), k]);
  }
  const sameAsNote = (key: string): string | null => {
    const id = identity(targets[key]);
    const others = id ? (byIdentity.get(id) ?? []).filter((k) => k !== key) : [];
    if (!others.length) return null;
    const receivables = !shared && isReceivableKey(key) && others.some(isReceivableKey);
    return `Same Xero account as ${listOf(others.map(cardLabel))}.${receivables ? " To share one receivable on purpose, choose “One for all channels” above." : ""}`;
  };

  const accountOptions = (cls: AccountClass[]): SelectMenuOption[] =>
    accounts
      .filter((a) => cls.includes(CLASS_OF_TYPE[a.type]))
      .map((a) => ({ value: `acc:${a.accountId}`, label: a.code ? `${a.code} · ${a.name}` : a.name, hint: XERO_TYPE_LABEL[a.type] ?? a.type }));
  /** An account's choices: a new account (its current name, or consl's), then Xero's chart of that kind. */
  function optionsFor(suggested: { name: string; type: string }, current: XeroTarget | null, cls: AccountClass[]): SelectMenuOption[] {
    const news = current?.kind === "new" ? [{ name: current.name, type: current.type }] : [];
    // A new account is always on offer, under a name that's still free in Xero ("… 2" once consl's is taken).
    let name = suggested.name;
    for (let i = 2; existingByName.has(norm(name)) && i < 100; i++) name = `${suggested.name} ${i}`;
    if (!news.some((n) => norm(n.name) === norm(name))) news.push({ name, type: suggested.type });
    const chart = accountOptions(cls);
    // An account the list hasn't caught up with yet (just created by a publish) still shows by name.
    const extra: SelectMenuOption[] =
      current?.kind === "account" && !chart.some((o) => o.value === `acc:${current.accountId}`)
        ? [{ value: `acc:${current.accountId}`, label: current.code ? `${current.code} · ${current.name}` : current.name, hint: XERO_TYPE_LABEL[current.type] ?? current.type }]
        : [];
    return [
      ...extra,
      ...news.map((n) => ({
        value: `new:${n.type}:${n.name}`,
        label: n.name,
        hint: `New ${(XERO_TYPE_LABEL[n.type] ?? n.type).toLowerCase()} account`,
        icon: (
          <span className="grid h-5 w-5 place-items-center rounded-md bg-chart-soft text-chart">
            <Plus size={12} />
          </span>
        ),
      })),
      ...chart,
    ];
  }
  function decode(value: string): XeroTarget | null {
    if (value.startsWith("acc:")) {
      const a = accounts.find((x) => x.accountId === value.slice(4));
      if (a) return { kind: "account", ...a };
      const cur = Object.values(targets).find((t) => t.kind === "account" && t.accountId === value.slice(4));
      return cur ?? null;
    }
    if (value.startsWith("new:")) {
      const rest = value.slice(4);
      const i = rest.indexOf(":");
      return { kind: "new", type: rest.slice(0, i), name: rest.slice(i + 1) };
    }
    return null;
  }

  const change = (fn: (s: XeroSetupState) => XeroSetupState) => {
    setState(fn);
    setNotice(null);
    setError(null);
  };
  const setTarget = (key: string, t: XeroTarget | null) => t && change((s) => ({ ...s, targets: { ...s.targets, [key]: t } }));
  const placeLine = (id: string, account: string) =>
    change((s) => ({ ...s, customLines: { ...s.customLines, [id]: { account, balance: s.customLines[id]?.balance ?? "" } } }));
  const unplaceLine = (id: string) =>
    change((s) => {
      const next = { ...s.customLines };
      delete next[id];
      return { ...s, customLines: next };
    });
  const setLineBalance = (id: string, balance: string) => change((s) => ({ ...s, customLines: { ...s.customLines, [id]: { ...s.customLines[id], balance } } }));
  /** Drop an account the owner added: its lines go back out of Xero (or lose their balance account). */
  const removeAdded = (key: string) =>
    change((s) => {
      const targets = { ...s.targets };
      delete targets[key];
      const customLines: XeroSetupState["customLines"] = {};
      for (const [id, c] of Object.entries(s.customLines)) {
        if (c.account === key) continue;
        customLines[id] = c.balance === key ? { ...c, balance: "" } : c;
      }
      return { ...s, targets, customLines };
    });

  const nameOf = (key: string) => targets[key]?.name ?? "";
  // A custom line's recommended accounts: its own P&L section's account (where consl's P&L shows
  // it), and the receivable of the channel its orders belong to. Each goes first in its picker.
  const plOptionsFor = (l: SetupLine): SelectMenuOption[] => {
    const cls = customClass(l);
    const rec = (LINE_ORDER as string[]).includes(l.group) && plClass(l.group, targets) === cls ? l.group : null;
    const keys = [...LINE_ORDER.filter((k) => plClass(k, targets) === cls), ...Object.keys(state.targets).filter((k) => isAddedAccount(k) && plClass(k, targets) === cls)];
    const ordered = rec ? [rec, ...keys.filter((k) => k !== rec)] : keys;
    return [
      ...ordered.map((k) => ({
        value: k,
        label: nameOf(k),
        hint: (LINE_ORDER as string[]).includes(k) ? `consl's account for ${LINES[k as LineKey].label.toLowerCase()}` : "An account you added",
        ...(k === rec ? { badge: "Recommended" } : {}),
      })),
      { value: NEW_OPTION, label: "New account…", hint: "Create one for this line", icon: <span className="grid h-5 w-5 place-items-center rounded-md bg-chart-soft text-chart"><Plus size={12} /></span> },
    ];
  };
  const balanceOptionsFor = (l: SetupLine): SelectMenuOption[] => {
    const own = viewKey(`receivable:${l.channel}`);
    const rec = balanceRows.some((b) => b.key === own) ? own : null;
    const rows = rec ? [...balanceRows.filter((b) => b.key === rec), ...balanceRows.filter((b) => b.key !== rec)] : balanceRows;
    return [
      ...rows.map((b) => ({
        value: b.key,
        label: nameOf(b.key) || b.label,
        hint: b.label === "Added by you" ? "A balance account you added" : b.label,
        ...(b.key === rec ? { badge: "Recommended" } : {}),
      })),
      { value: NEW_OPTION, label: "New balance account…", hint: "Create one for this line", icon: <span className="grid h-5 w-5 place-items-center rounded-md bg-chart-soft text-chart"><Plus size={12} /></span> },
    ];
  };

  // Where each balance account's number comes from: the P&L accounts (or Tax owed) whose lines
  // move its money, each with the sign it moves it by.
  const formulas = useMemo(() => {
    const out = new Map<string, Map<string, { name: string; amount: number; note?: string; tax: boolean }>>();
    for (const l of lines) {
      const choice = l.custom ? placed[l.id] : undefined;
      if (l.custom && !choice?.balance) continue;
      const pl = l.custom ? choice!.account : lockedAccountOf(l);
      const name = l.group === "taxes" ? "Tax owed" : pl ? plainName(targets[pl]?.name ?? "") : "";
      for (const b of balancesOf(l, choice)) {
        const key = shared && isReceivableKey(b.key) ? SHARED_RECEIVABLE_KEY : b.key;
        const m = out.get(key) ?? new Map();
        // One term per account: a note ("ad invoices paid by card") stays only while every line in
        // the term carries it.
        const cur = m.get(name) ?? { name, amount: 0, note: b.note, tax: l.group === "taxes" };
        if (cur.note !== b.note) cur.note = undefined;
        cur.amount += l.amount;
        m.set(name, cur);
        out.set(key, m);
      }
    }
    return out;
  }, [lines, placed, targets, shared]);

  // What publishing will create, what's still missing, and names Xero already has.
  const usedKeys = useMemo(() => {
    const view = (k: string) => (shared && isReceivableKey(k) ? SHARED_RECEIVABLE_KEY : k);
    const keys = new Set<string>(data.balances.map((b) => view(b.key)));
    for (const l of lines) {
      if (!l.custom) {
        const k = lockedAccountOf(l);
        if (k) keys.add(k);
      } else if (placed[l.id]) {
        keys.add(placed[l.id].account);
        if (placed[l.id].balance) keys.add(view(placed[l.id].balance));
      }
    }
    if (choice === "match") keys.add(INVENTORY_ADJUSTMENT_KEY);
    return keys;
  }, [lines, placed, data.balances, choice, shared]);
  const { newAccounts, clashes } = useMemo(() => {
    const seen = new Map<string, { name: string; type: string }>();
    let taken = 0;
    for (const k of usedKeys) {
      const t = targets[k];
      if (t?.kind !== "new") continue;
      if (existingByName.has(norm(t.name))) taken++;
      else seen.set(`${t.type}|${norm(t.name)}`, { name: t.name.trim(), type: t.type });
    }
    return { newAccounts: [...seen.values()], clashes: taken };
  }, [usedKeys, targets, existingByName]);
  const missingBalance = Object.entries(placed).filter(([id, c]) => byId.has(id) && !c.balance).length;

  async function saveDraft() {
    setPending("save");
    setError(null);
    try {
      const next = { ...state, targets, customLines: placed };
      const r = await saveXeroDraftAction(next);
      if (!r.ok) return setError(r.error);
      setState(next);
      setSaved(next);
      setDraftAt(r.draftSavedAt);
      setNotice("Draft saved. Nothing changed in Xero.");
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setPending(null);
    }
  }

  async function discardDraft() {
    setPending("discard");
    setError(null);
    try {
      const r = await discardXeroDraftAction();
      if (!r.ok) return setError(r.error);
      const base = published ?? data.defaults;
      setState(base);
      setSaved(base);
      setDraftAt(null);
      setNotice(published ? "Draft discarded. Back to what's in Xero." : "Draft discarded.");
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setPending(null);
    }
  }

  function askPublish() {
    if (matchBlocked) {
      setError(
        openingData?.xero.reconnect
          ? "To match consl's value, reconnect Xero first, or keep Xero's inventory number."
          : "consl has no stock value for the day before your start date. Pick a later start date, or keep Xero's inventory number.",
      );
      return;
    }
    if (missingBalance) {
      setError(`Pick a balance account for ${missingBalance === 1 ? "the custom line" : `the ${missingBalance} custom lines`} you're sending to Xero.`);
      return;
    }
    setError(null);
    setConfirming(true);
  }

  async function publish() {
    setConfirming(false);
    setPending("publish");
    setError(null);
    setNotice(null);
    try {
      const r = await publishXeroSetupAction({ ...state, targets, customLines: placed });
      if (!r.ok) {
        setError(r.error);
        // Accounts made before it stopped are real now: show them, so a retry picks them up.
        if (r.settled) setState((s) => ({ ...s, targets: { ...s.targets, ...r.settled } }));
        void refreshAccounts(true);
        return;
      }
      const next = { ...state, targets: { ...targets, ...r.targets }, customLines: placed };
      setState(next);
      setSaved(next);
      setPublished(next);
      setDraftAt(null);
      setSavedAt(new Date().toISOString());
      setNotice(
        r.created.length
          ? `Published. ${r.created.length} new ${r.created.length === 1 ? "account was" : "accounts were"} added to ${data.orgName} in Xero.`
          : "Published to Xero.",
      );
      router.refresh();
      void refreshAccounts(true);
    } catch {
      setError("Couldn't reach the server. Reload to check whether it was published.");
    } finally {
      setPending(null);
    }
  }

  // Dragging a line added in consl: into an account of its kind, or back out of Xero.
  const dropProps = (zone: string, accepts: (l: SetupLine) => boolean, onDrop: (id: string) => void) => ({
    onDragOver: (e: DragEvent) => {
      const l = dragging ? byId.get(dragging) : undefined;
      if (!l || !accepts(l)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (over !== zone) setOver(zone);
    },
    onDragLeave: (e: DragEvent) => {
      if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setOver((o) => (o === zone ? null : o));
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      const l = dragging ? byId.get(dragging) : undefined;
      setOver(null);
      setDragging(null);
      if (l && accepts(l)) onDrop(l.id);
    },
  });
  const dragProps = (l: SetupLine) =>
    editable
      ? {
          draggable: true,
          onDragStart: (e: DragEvent) => {
            e.dataTransfer.setData("text/plain", l.id);
            e.dataTransfer.effectAllowed = "move";
            setDragging(l.id);
          },
          onDragEnd: () => {
            setDragging(null);
            setOver(null);
          },
        }
      : {};

  const lineView = (l: SetupLine, slot: ReactNode) => (
    <div key={l.id} {...(l.custom ? dragProps(l) : {})} className={`flex min-h-[38px] items-center gap-2.5 px-4 py-1.5 ${l.custom && editable ? "cursor-grab active:cursor-grabbing" : ""} ${dragging === l.id ? "opacity-40" : ""}`}>
      {l.custom ? (
        <GripVertical size={14} className="shrink-0 text-muted" />
      ) : (
        <span title="Always sent to Xero, always to this account" className="shrink-0 text-muted">
          <Lock size={13} />
        </span>
      )}
      <span className="flex shrink-0 items-center gap-1">
        {marksOf(l).map((m) => (
          <MarkTile key={m.src} src={m.src} title={m.title} />
        ))}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[13px] text-ink" title={l.line}>
            {l.line}
          </span>
          <span className={`${PILL} ${CHANNEL_PILL[l.channel]}`} title={`Tagged ${CHANNEL_NAME[l.channel]} in Xero`}>
            {CHANNEL_NAME[l.channel]}
          </span>
          {l.custom && <span className={`${PILL} pill-neutral`}>{l.credit ? "Custom credit" : "Custom fee"}</span>}
        </div>
        {l.custom && <div className="truncate text-[11px] text-muted">Shows under {GROUP_LABEL[l.group] ?? l.group} in your P&amp;L</div>}
      </div>
      {slot}
      <span className="w-[92px] shrink-0 text-right text-[12.5px] tabular-nums text-ink-soft">{money(l.amount)}</span>
    </div>
  );

  const plCard = (key: string) => {
    const t = targets[key] ?? null;
    const own = (LINE_ORDER as string[]).includes(key);
    const cls = plClass(key, targets);
    const its = linesOf(key);
    const zone = `pl:${key}`;
    return (
      <div
        key={key}
        {...dropProps(zone, (l) => l.custom && customClass(l) === cls && placed[l.id]?.account !== key, (id) => placeLine(id, key))}
        className={`overflow-hidden rounded-[var(--radius-card)] border bg-surface transition-colors ${over === zone ? "border-accent bg-accent-soft/30" : "border-border"}`}
      >
        <AccountHeader
          caption={own ? `Your ${LINES[key as LineKey].label.toLowerCase()}` : "An account you added"}
          sameAs={sameAsNote(key)}
          target={t}
          options={optionsFor(own ? { name: newAccountName(LINES[key as LineKey].suggest.name), type: LINES[key as LineKey].suggest.type } : { name: t?.name ?? "", type: t?.type ?? "DIRECTCOSTS" }, t, [cls])}
          clash={clashOf(t)}
          stale={data.stale.includes(key)}
          disabled={!editable}
          onPick={(v) => setTarget(key, decode(v))}
          onRename={(name) => t?.kind === "new" && setTarget(key, { kind: "new", type: t.type, name })}
          onRemove={!own && editable ? () => removeAdded(key) : undefined}
          total={its.length ? money(its.reduce((s, l) => s + l.amount, 0)) : null}
        />
        <div className="divide-y divide-line border-t border-line">
          {its.length === 0 && <div className="px-4 py-3 text-[12px] text-muted">{editable ? "Drag a line you added in consl here." : "No lines yet."}</div>}
          {its.map((l) =>
            lineView(
              l,
              l.custom ? (
                <>
                  <div className="w-[230px] shrink-0">
                    <SelectMenu
                      size="sm"
                      value={viewKey(placed[l.id]?.balance ?? "")}
                      onChange={(v) =>
                        v === NEW_OPTION
                          ? setAdding({ kind: "balance", line: l.id })
                          : // The shared receivable is kept as the line's own channel's, so switching back keeps it.
                            setLineBalance(l.id, v === SHARED_RECEIVABLE_KEY ? `receivable:${l.channel}` : v)
                      }
                      options={balanceOptionsFor(l)}
                      placeholder="Pick a balance account"
                      ariaLabel={`Balance account for ${l.line}`}
                      disabled={!editable}
                    />
                  </div>
                  {editable && (
                    <button type="button" onClick={() => unplaceLine(l.id)} title="Don't send to Xero" aria-label={`Don't send ${l.line} to Xero`} className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink">
                      <X size={14} />
                    </button>
                  )}
                </>
              ) : null,
            ),
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {notice && (
        <div className="flex items-center gap-2 rounded-lg border border-positive/25 bg-positive/10 px-3 py-2 text-[12.5px] text-positive">
          <Check size={14} /> {notice}
        </div>
      )}

      <HowItWorks />

      {/* Options for the whole export. */}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-[var(--radius-card)] border border-border bg-surface px-5 py-3.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-ink">
            Start sending from
            <HoverHint
              title="Start date"
              body="consl sends everything from this day on, one journal per channel for each month, once the month is over. If you don't start on the 1st, the first journal covers the rest of that month only. Anything before this day stays as it is in Xero."
            />
          </span>
          <DatePicker value={state.startDate} onChange={(d) => d && change((s) => ({ ...s, startDate: d }))} fullWidth={false} className="w-[150px]" disabled={!editable} />
          <span className="text-[12px] text-muted">{firstJournal(state.startDate, locale)}</span>
        </div>
        {data.channels.length > 0 && (
          <div className="inline-flex items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-ink">
              Tag lines by sales channel
              <HoverHint
                title="Sales channel tags"
                body="Adds a “Sales channel” tracking category in Xero and tags every line with Amazon, Shopify or TikTok Shop, so any account can be split by channel in Xero's reports."
              />
            </span>
            <Switch checked={state.tagChannels} onChange={(v) => change((s) => ({ ...s, tagChannels: v }))} disabled={!editable} label="Tag lines by sales channel" />
          </div>
        )}
      </div>

      <StartingInventoryCard
        choice={choice}
        onChoice={(c) => change((s) => ({ ...s, inventoryOpening: c }))}
        data={openingData}
        loading={!openingNow}
        error={openingNow?.error ?? null}
        diff={openingDiff}
        startDate={state.startDate}
        inventoryName={invTarget ? (invTarget.kind === "account" && invTarget.code ? `${invTarget.code} · ${invTarget.name}` : invTarget.name) : "Inventory"}
        disabled={!editable}
        money={money}
        locale={locale}
        onUseAccount={(a) => setTarget("inventory", { kind: "account", accountId: a.accountId, code: a.code, name: a.name, type: a.type })}
        adjustment={
          <AccountHeader
            caption="Inventory adjustment account"
            hint="Where the difference shows in your P&L"
            sameAs={sameAsNote(INVENTORY_ADJUSTMENT_KEY)}
            target={targets[INVENTORY_ADJUSTMENT_KEY] ?? null}
            options={optionsFor({ name: newAccountName(INVENTORY_ADJUSTMENT_SUGGEST.name), type: INVENTORY_ADJUSTMENT_SUGGEST.type }, targets[INVENTORY_ADJUSTMENT_KEY] ?? null, ["cost", "income"])}
            clash={clashOf(targets[INVENTORY_ADJUSTMENT_KEY])}
            stale={data.stale.includes(INVENTORY_ADJUSTMENT_KEY)}
            disabled={!editable}
            onPick={(v) => setTarget(INVENTORY_ADJUSTMENT_KEY, decode(v))}
            onRename={(name) => {
              const t = targets[INVENTORY_ADJUSTMENT_KEY];
              if (t?.kind === "new") setTarget(INVENTORY_ADJUSTMENT_KEY, { kind: "new", type: t.type, name });
            }}
            total={null}
          />
        }
      />

      {/* Lines added in consl that aren't sent. */}
      {customLines.length > 0 && (
        <section
          {...dropProps("excluded", (l) => l.custom && !!placed[l.id], unplaceLine)}
          className={`overflow-hidden rounded-[var(--radius-card)] border border-dashed transition-colors ${over === "excluded" ? "border-accent bg-accent-soft/30" : "border-border bg-surface"}`}
        >
          <div className="px-5 py-4">
            <h2 className="text-[15px] font-semibold text-ink">Not sent to Xero</h2>
            <p className="mt-0.5 text-[12.5px] text-muted">
              Lines you added in consl (custom fees and credits). Their bill may already be in Xero, so they stay out until you place one in an account. Drag it there, or pick one.
            </p>
          </div>
          <div className="divide-y divide-line border-t border-line">
            {excluded.length === 0 && <div className="px-4 py-3 text-[12px] text-muted">Every line you added is sent to Xero.</div>}
            {excluded.map((l) =>
              lineView(
                l,
                <div className="w-[230px] shrink-0">
                  <SelectMenu
                    size="sm"
                    value=""
                    onChange={(v) => (v === NEW_OPTION ? setAdding({ kind: "pl", line: l.id, cls: customClass(l) }) : placeLine(l.id, v))}
                    options={plOptionsFor(l)}
                    placeholder="Send to an account…"
                    ariaLabel={`Send ${l.line} to an account`}
                    disabled={!editable}
                  />
                </div>,
              ),
            )}
          </div>
        </section>
      )}

      {/* P&L accounts with their lines */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">P&amp;L accounts</h2>
            <p className="mt-0.5 text-[12.5px] text-muted">
              Each line of your consl P&amp;L, under the Xero account it posts to. Locked lines always go there; pick which Xero account each one is. Amounts are all time.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void refreshAccounts(false)}
              disabled={refreshing}
              title="Read your Xero chart of accounts again"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-[12px] text-ink-soft hover:bg-surface-2 disabled:opacity-60"
            >
              <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
              {refreshing ? "Reading Xero…" : "Refresh accounts"}
            </button>
            {editable && (
              <button type="button" onClick={() => setAdding({ kind: "pl" })} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-[12px] font-medium text-ink-soft hover:bg-surface-2">
                <Plus size={13} /> New account
              </button>
            )}
          </div>
        </div>
        {plKeys.length === 0 && <div className="rounded-[var(--radius-card)] border border-border bg-surface px-5 py-6 text-center text-[13px] text-muted">Your P&amp;L has no lines yet.</div>}
        {plKeys.map(plCard)}
      </section>

      {/* Balance sheet */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">Balance sheet</h2>
            <p className="mt-0.5 text-[12.5px] text-muted">
              Where the money waits until cash moves, and how each number is made. When a payout or card charge reaches your bank, reconcile it to the matching account.
            </p>
          </div>
          {editable && (
            <button type="button" onClick={() => setAdding({ kind: "balance" })} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-[12px] font-medium text-ink-soft hover:bg-surface-2">
              <Plus size={13} /> New balance account
            </button>
          )}
        </div>
        {canShare && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-card)] border border-border bg-surface px-4 py-3">
            <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-ink">
              Channel receivables
              <HoverHint
                title="Channel receivables"
                body="One per channel: each sales channel gets its own receivable, and each payout is reconciled to its channel's account, so Xero shows what each channel still owes you. One for all channels: every channel shares one receivable account (for example the one your books already use), and every payout is reconciled to it."
              />
            </span>
            <div role="tablist" aria-label="Channel receivables" className="flex h-8 items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5">
              {[false, true].map((v) => (
                <button
                  key={String(v)}
                  type="button"
                  role="tab"
                  aria-selected={shared === v}
                  disabled={!editable}
                  onClick={() => change((s) => ({ ...s, sharedReceivable: v }))}
                  className={`flex h-full items-center rounded-md px-2.5 text-[12px] transition-colors disabled:cursor-default ${shared === v ? "bg-surface-2 font-medium text-ink" : "text-muted hover:text-ink-soft"}`}
                >
                  {v ? "One for all channels" : "One per channel"}
                </button>
              ))}
            </div>
            <span className="basis-full text-[12px] leading-snug text-muted">
              {shared
                ? `${listOf(receivableChannels.map((c) => CHANNEL_NAME[c]))} share one receivable account. Reconcile every payout to it.${state.tagChannels ? " Channel tags still split it by channel in Xero's reports." : ""}`
                : `${listOf(receivableChannels.map((c) => CHANNEL_NAME[c]))} each get their own receivable account. Reconcile each payout to its channel's account.`}
            </span>
          </div>
        )}
        {balanceRows.map((b) => {
          const t = targets[b.key] ?? null;
          const isShared = b.key === SHARED_RECEIVABLE_KEY;
          const terms = [...(formulas.get(b.key)?.values() ?? [])].map((x) => ({
            name: x.name,
            note: x.note,
            sign: (x.tax ? "+" : b.cls === "liability" ? (x.amount <= 0 ? "+" : "−") : x.amount >= 0 ? "+" : "−") as "+" | "−",
          }));
          const hasShopify = b.key === "receivable:SHOPIFY" || (isShared && receivableChannels.includes("SHOPIFY"));
          return (
            <div key={b.key} className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
              <AccountHeader
                caption={b.label}
                hint={b.hint}
                tags={
                  isShared ? (
                    <span className="inline-flex flex-wrap items-center gap-1">
                      {receivableChannels.map((c) => (
                        <span key={c} className={`${PILL} ${CHANNEL_PILL[c]}`}>
                          {CHANNEL_NAME[c]}
                        </span>
                      ))}
                    </span>
                  ) : undefined
                }
                sameAs={sameAsNote(b.key)}
                target={t}
                options={optionsFor({ name: newAccountName(b.suggest.name), type: b.suggest.type }, t, [b.cls])}
                clash={clashOf(t)}
                stale={data.stale.includes(b.key)}
                disabled={!editable}
                onPick={(v) => setTarget(b.key, decode(v))}
                onRename={(name) => t?.kind === "new" && setTarget(b.key, { kind: "new", type: t.type, name })}
                onRemove={isAddedBalance(b.key) && editable ? () => removeAdded(b.key) : undefined}
                total={null}
              />
              <BalanceBreakdown
                terms={terms}
                codeHere={isShared ? receivableRows.flatMap((r) => codeHereOf(r.key, "asset")) : codeHereOf(b.key, b.cls)}
                notes={[
                  ...(b.key === "inventory" && choice === "match"
                    ? [`On ${dayText(state.startDate, locale)}, consl also adds one starting adjustment so this account matches consl's stock value (see Starting inventory).`]
                    : []),
                  ...(hasShopify && data.regularPaypal
                    ? [`Regular PayPal fees never reach Shopify's records, so consl adds PayPal's standard fee to those orders (${PAYPAL_STANDARD_FEE.percent}% + $${PAYPAL_STANDARD_FEE.fixed.toFixed(2)}). If your rate is different, change it in Orders › Automatic rules.`]
                    : []),
                  ...(hasShopify
                    ? [
                        "Orders from other channels that come in through your Shopify store (Etsy, Faire, wholesale apps…): consl can't see their fees. Either add their fees with a rule and reconcile their payouts to this account, or void those orders and record them straight in Xero.",
                      ]
                    : []),
                  ...(isShared
                    ? [
                        state.tagChannels
                          ? "Every line consl sends here keeps its sales channel tag, so Xero's reports can still split this account by channel."
                          : "Turn on “Tag lines by sales channel” above to split this account by channel in Xero's reports.",
                      ]
                    : []),
                ]}
              />
            </div>
          );
        })}
      </section>

      {!canEdit && <p className="text-[12.5px] text-muted">Only people who can edit settings can change this setup.</p>}

      {/* Save bar: Cancel undoes, Save keeps a draft in consl, Publish reaches Xero. */}
      {canEdit && (dirty || unpublished || error) && (
        <div className="sticky bottom-4 z-20">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface/95 px-4 py-3 shadow-lg backdrop-blur">
            <div className="min-w-0 text-[12.5px]">
              {error ? (
                <span className="inline-flex items-center gap-1.5 text-negative">
                  <AlertTriangle size={13} /> {error}
                </span>
              ) : clashes ? (
                <span className="inline-flex items-center gap-1.5 text-negative">
                  <AlertTriangle size={13} /> {clashes === 1 ? "One new account has a name" : `${clashes} new accounts have names`} already used in Xero. Rename {clashes === 1 ? "it" : "them"}, or pick the existing account.
                </span>
              ) : dirty ? (
                <span className="text-ink-soft">You have unsaved changes.</span>
              ) : draftAt ? (
                <span className="text-ink-soft">Draft saved {when(draftAt, locale)}. Not in Xero yet.</span>
              ) : (
                <span className="text-ink-soft">Nothing goes to Xero until you publish this setup.</span>
              )}
              {!error && !clashes && missingBalance > 0 && (
                <span className="ml-1.5 text-warn">
                  {missingBalance === 1 ? "One custom line needs" : `${missingBalance} custom lines need`} a balance account.
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {dirty ? (
                <>
                  <button type="button" onClick={() => change(() => saved)} disabled={busy} className="rounded-lg px-3 py-2 text-[12.5px] font-medium text-muted hover:text-ink-soft disabled:opacity-50">
                    Cancel
                  </button>
                  <button type="button" onClick={saveDraft} disabled={busy} className="rounded-lg border border-border bg-surface px-3.5 py-2 text-[13px] font-medium text-ink-soft hover:bg-surface-2 disabled:opacity-50">
                    {pending === "save" ? "Saving…" : "Save"}
                  </button>
                </>
              ) : (
                draftAt && (
                  <button type="button" onClick={discardDraft} disabled={busy} className="rounded-lg px-3 py-2 text-[12.5px] font-medium text-muted hover:text-ink-soft disabled:opacity-50">
                    {pending === "discard" ? "Discarding…" : "Discard draft"}
                  </button>
                )
              )}
              <button
                type="button"
                disabled={busy || clashes > 0}
                onClick={askPublish}
                className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-bg hover:opacity-90 disabled:opacity-50"
              >
                {pending === "publish" ? "Publishing…" : "Publish to Xero"}
              </button>
            </div>
          </div>
        </div>
      )}
      {canEdit && !dirty && !unpublished && savedAt && <p className="text-[12px] text-muted">Published to Xero {when(savedAt, locale)}.</p>}

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setConfirming(false)}>
          <div role="dialog" aria-modal="true" aria-label="Publish to Xero" className="org-pop w-full max-w-md rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-[15px] font-semibold text-ink">Publish to Xero?</h3>
              <button type="button" onClick={() => setConfirming(false)} aria-label="Close" className="text-muted hover:text-ink">
                <X size={18} />
              </button>
            </div>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">Your monthly journals to {data.orgName} will use this setup.</p>
            {newAccounts.length > 0 && (
              <>
                <p className="mt-3 text-[12.5px] font-medium text-ink">
                  Adds {newAccounts.length} {newAccounts.length === 1 ? "account" : "accounts"} to your Xero chart
                </p>
                <ul className="mt-1.5 max-h-[30vh] divide-y divide-line overflow-y-auto rounded-xl border border-border">
                  {newAccounts.map((a) => (
                    <li key={`${a.type}|${a.name}`} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
                      <span className="truncate text-ink">{a.name}</span>
                      <span className="shrink-0 text-[12px] text-muted">{XERO_TYPE_LABEL[a.type] ?? a.type}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className="mt-3 rounded-xl border border-border px-3 py-2.5">
              <p className="text-[12.5px] font-medium text-ink">Starting inventory</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-muted">
                {choice === "keep"
                  ? "Xero's inventory number stays as it is."
                  : openingDiff === 0
                    ? "Xero already matches consl. Nothing to adjust."
                    : openingDiff !== null
                      ? `One adjustment on ${dayText(state.startDate, locale)}: ${openingDiff > 0 ? "+" : "−"}${money(Math.abs(openingDiff))} to Xero's inventory, in ${plainName(targets[INVENTORY_ADJUSTMENT_KEY]?.name ?? "Inventory Adjustments")}.`
                      : `One adjustment on ${dayText(state.startDate, locale)} so Xero's inventory matches consl.`}
              </p>
            </div>
            {excluded.length > 0 && (
              <div className="mt-3 rounded-xl border border-warn/30 bg-warn/10 px-3 py-2.5">
                <p className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-warn">
                  <AlertTriangle size={13} /> {excluded.length === 1 ? "1 line you added isn't sent" : `${excluded.length} lines you added aren't sent`}
                </p>
                <ul className="mt-1 space-y-0.5 text-[12px] text-ink-soft">
                  {excluded.map((l) => (
                    <li key={l.id}>
                      {CHANNEL_NAME[l.channel]} · {l.line} ({GROUP_LABEL[l.group] ?? l.group}) · {money(l.amount)}
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
                  Record {excluded.length === 1 ? "it" : "them"} in Xero yourself, straight to your P&amp;L, from your card payments or bank statement.
                </p>
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirming(false)} className="rounded-lg border border-border px-3.5 py-2 text-[13px] text-ink-soft hover:bg-surface-2">
                Cancel
              </button>
              <button type="button" onClick={publish} className="rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-bg hover:opacity-90">
                Publish
              </button>
            </div>
          </div>
        </div>
      )}

      {adding && (
        <NewAccountDialog
          kind={adding.kind}
          cls={adding.cls}
          taken={(name) => Object.values(targets).some((t) => norm(t.name) === norm(name))}
          onClose={() => setAdding(null)}
          onAdd={(name, type) => {
            const key = `${adding.kind === "pl" ? "acct" : "bal"}:${shortKey()}`;
            const line = adding.line;
            change((s) => {
              const next: XeroSetupState = { ...s, targets: { ...s.targets, [key]: { kind: "new", name, type } } };
              if (line && adding.kind === "pl") next.customLines = { ...s.customLines, [line]: { account: key, balance: s.customLines[line]?.balance ?? "" } };
              if (line && adding.kind === "balance") next.customLines = { ...s.customLines, [line]: { ...s.customLines[line], balance: key } };
              return next;
            });
            setAdding(null);
          }}
        />
      )}
    </div>
  );
}

/** An account's head: what it is, the Xero account behind it (consl's new one, renamable, or one
 *  of the company's), its total, and, for an account the owner added, a way to remove it. */
function AccountHeader({
  caption,
  hint,
  tags,
  sameAs,
  target,
  options,
  clash,
  stale,
  disabled,
  onPick,
  onRename,
  onRemove,
  total,
}: {
  caption: string;
  hint?: string;
  /** Shown after the caption (the channels a shared receivable covers). */
  tags?: ReactNode;
  /** The other cards that post to this same Xero account, in words. */
  sameAs?: string | null;
  target: XeroTarget | null;
  options: SelectMenuOption[];
  clash: XeroAccountOption | null;
  stale: boolean;
  disabled: boolean;
  onPick: (v: string) => void;
  onRename: (name: string) => void;
  onRemove?: () => void;
  total: string | null;
}) {
  const isNew = target?.kind === "new";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  function commit() {
    const name = draft.trim().slice(0, 150);
    if (name) onRename(name);
    setEditing(false);
  }
  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="min-w-[220px] max-w-[360px] flex-1">
          {editing ? (
            <div className="flex h-9 items-center gap-2 rounded-[10px] border border-ink/30 bg-surface px-3">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-chart-soft text-chart">
                <Plus size={12} />
              </span>
              <input
                autoFocus
                onFocus={(e) => e.currentTarget.select()}
                value={draft}
                maxLength={150}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit();
                  if (e.key === "Escape") setEditing(false);
                }}
                aria-label={`Name of the new account for ${caption}`}
                className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none"
              />
            </div>
          ) : (
            <SelectMenu value={target ? targetValue(target) : ""} onChange={onPick} options={options} placeholder="Pick an account" ariaLabel={`Xero account for ${caption}`} disabled={disabled} />
          )}
        </div>
        {isNew && !disabled && !editing && (
          <button
            type="button"
            onClick={() => {
              if (target?.kind !== "new") return;
              setDraft(target.name);
              setEditing(true);
            }}
            aria-label={`Rename the new account for ${caption}`}
            title="Rename"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-border text-muted transition-colors hover:border-ink/25 hover:text-ink"
          >
            <Pencil size={14} />
          </button>
        )}
        {isNew && (
          <HoverHint title="New account" body="consl adds this account to your Xero chart when you publish. Rename it with the pencil, or pick one of your own Xero accounts instead." className="rounded-full">
            <span className="pill-chart inline-flex items-center gap-1 rounded-full border py-[1px] pl-1.5 pr-1 text-[10.5px] font-medium">
              New account
              <Info size={11} />
            </span>
          </HoverHint>
        )}
        <span className="ml-auto flex items-center gap-2">
          {total !== null && <span className="text-[13px] font-medium tabular-nums text-ink">{total}</span>}
          {onRemove && (
            <button type="button" onClick={onRemove} title="Remove this account" aria-label="Remove this account" className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-negative">
              <Trash2 size={14} />
            </button>
          )}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
        <span>
          {caption}
          {hint ? ` · ${hint}` : ""}
        </span>
        {tags}
      </div>
      {sameAs && (
        <div className="mt-1 flex items-start gap-1 text-[11.5px] leading-snug text-ink-soft">
          <Info size={11} className="mt-[2px] shrink-0 text-accent" />
          <span>{sameAs}</span>
        </div>
      )}
      {stale && (
        <div className="mt-1 inline-flex items-center gap-1 text-[11.5px] text-warn">
          <AlertTriangle size={11} /> The account saved here is gone from Xero. Pick another.
        </div>
      )}
      {clash && (
        <div className="mt-1 inline-flex items-start gap-1 text-[11.5px] leading-snug text-negative">
          <AlertTriangle size={11} className="mt-[2px] shrink-0" />
          <span>
            {clash.code ? `${clash.code} · ` : ""}
            {clash.name} is already in Xero. Rename the new account, or pick that one from the list.
          </span>
        </div>
      )}
    </div>
  );
}

/** How a balance account's number is made: what consl's journals send to it (the accounts that
 *  move it, each with its sign), then — highlighted — what the owner codes to it in Xero. */
function BalanceBreakdown({ terms, codeHere, notes }: { terms: { name: string; sign: "+" | "−"; note?: string }[]; codeHere: string[]; notes: string[] }) {
  return (
    <div className="border-t border-line">
      <div className="px-4 py-2.5">
        <div className="text-[10.5px] font-medium uppercase tracking-[0.06em] text-muted">consl sends here</div>
        <div className="mt-1 text-[12.5px] leading-relaxed text-ink-soft">
          {terms.length === 0 ? (
            <span className="text-muted">Nothing yet.</span>
          ) : (
            terms.map((t, i) => (
              <span key={t.name}>
                {i > 0 ? ` ${t.sign} ` : t.sign === "−" ? "− " : ""}
                <span className="font-medium text-ink">{t.name}</span>
                {t.note && <span className="text-muted"> ({t.note})</span>}
              </span>
            ))
          )}
        </div>
      </div>
      <div className="mx-3 mb-3 rounded-lg border border-accent/25 bg-accent-soft/60 px-3 py-2.5">
        <div className="text-[10.5px] font-medium uppercase tracking-[0.06em] text-accent">Reconcile to this account in Xero</div>
        <ul className="mt-1 space-y-1">
          {codeHere.map((c) => (
            <li key={c} className="flex items-start gap-1.5 text-[12.5px] leading-snug text-ink">
              <ArrowRight size={12} className="mt-[3px] shrink-0 text-accent" />
              <span>{c}</span>
            </li>
          ))}
        </ul>
      </div>
      {notes.length > 0 && (
        <div className="space-y-1.5 px-4 pb-3">
          {notes.map((n) => (
            <p key={n} className="flex items-start gap-1.5 text-[12px] leading-snug text-muted">
              <Info size={12} className="mt-[2px] shrink-0" />
              <span>{n}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function NewAccountDialog({
  kind,
  cls,
  taken,
  onClose,
  onAdd,
}: {
  kind: "pl" | "balance";
  cls?: AccountClass;
  taken: (name: string) => boolean;
  onClose: () => void;
  onAdd: (name: string, type: string) => void;
}) {
  const types = (kind === "pl" ? NEW_PL_TYPES : NEW_BALANCE_TYPES).filter((t) => !cls || CLASS_OF_TYPE[t.type] === cls);
  const [name, setName] = useState("");
  const [type, setType] = useState<string>(types[0].type);
  const [err, setErr] = useState<string | null>(null);
  const full = name.trim() ? newAccountName(name.trim().replace(/^consl - /i, "")) : "";
  function submit() {
    if (!name.trim()) return setErr("Give the account a name.");
    if (full.length > 150) return setErr("Keep the name under 150 characters.");
    if (taken(full)) return setErr("Another account already has that name.");
    onAdd(full, type);
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="New account" className="org-pop w-full max-w-sm rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-[15px] font-semibold text-ink">{kind === "pl" ? "New P&L account" : "New balance account"}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted hover:text-ink">
            <X size={18} />
          </button>
        </div>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">consl adds it to your Xero chart when you publish, if anything is in it.</p>
        <label className="mt-3 block text-[12px] font-medium text-ink-soft" htmlFor="new-account-name">
          Name
        </label>
        <div className="mt-1 flex h-9 items-center rounded-[10px] border border-border bg-surface px-3 focus-within:border-ink/30">
          <span className="shrink-0 text-[13px] text-muted">consl -&nbsp;</span>
          <input
            id="new-account-name"
            autoFocus
            value={name}
            maxLength={140}
            onChange={(e) => {
              setName(e.target.value);
              setErr(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder={kind === "pl" ? "Custom fulfillment fees" : "3PL payable"}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none"
          />
        </div>
        {types.length > 1 && (
          <>
            <div className="mt-3 text-[12px] font-medium text-ink-soft">Kind</div>
            <div className="mt-1">
              <SelectMenu value={type} onChange={setType} options={types.map((t) => ({ value: t.type, label: t.label }))} ariaLabel="Kind of account" />
            </div>
          </>
        )}
        {err && <p className="mt-2 text-[12px] text-negative">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-3.5 py-2 text-[13px] text-ink-soft hover:bg-surface-2">
            Cancel
          </button>
          <button type="button" onClick={submit} className="rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-bg hover:opacity-90">
            Add account
          </button>
        </div>
      </div>
    </div>
  );
}

function MarkTile({ src, title }: { src: string; title?: string }) {
  return (
    <span title={title} className="grid h-[18px] w-[18px] shrink-0 place-items-center overflow-hidden rounded-[5px] border border-border bg-white p-[2px]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className="max-h-full max-w-full object-contain" />
    </span>
  );
}

function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full transition-colors disabled:cursor-default disabled:opacity-50 ${checked ? "bg-accent" : "bg-border"}`}
    >
      <span className={`inline-block h-[18px] w-[18px] rounded-full bg-white shadow transition-transform ${checked ? "translate-x-[18px]" : "translate-x-[2px]"}`} />
    </button>
  );
}

function HowItWorks() {
  const steps = [
    { title: "Every line has an account", text: "Each line of your consl P&L sits under the Xero account it posts to. Lines you added in consl are yours to place." },
    { title: "Monthly journals", text: "When a month is complete, consl sends one journal per channel, dated when things happened." },
    { title: "Reconcile your payouts", text: "Reconcile each payout to its receivable account in Xero. What's left is what your channels still owe you." },
  ];
  return (
    <div className="grid overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface sm:grid-cols-3">
      {steps.map((s, i) => (
        <div key={s.title} className={`flex gap-3 px-5 py-4 ${i > 0 ? "border-t border-line sm:border-l sm:border-t-0" : ""}`}>
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-chart-soft text-[12px] font-medium text-chart">{i + 1}</span>
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-ink">{s.title}</div>
            <div className="mt-0.5 text-[12px] leading-snug text-muted">{s.text}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** "A", "A and B", "A, B and C". */
function listOf(xs: string[]): string {
  return xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

/** "Sep 30, 2026" for a day. */
function dayText(day: string, locale: string): string {
  return day ? new Date(`${day}T00:00:00Z`).toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "";
}

/**
 * How Xero's inventory starts: consl's stock value and Xero's number, both at the end of the day
 * before the start date, and the owner's choice: move Xero to consl's value (one adjustment on the
 * start date, in that month's P&L) or keep Xero's number.
 */
function StartingInventoryCard({
  choice,
  onChoice,
  data,
  loading,
  error,
  diff,
  startDate,
  inventoryName,
  disabled,
  money,
  locale,
  onUseAccount,
  adjustment,
}: {
  choice: "match" | "keep";
  onChoice: (c: "match" | "keep") => void;
  data: StartingInventory | null;
  loading: boolean;
  error: string | null;
  diff: number | null;
  startDate: string;
  inventoryName: string;
  disabled: boolean;
  money: (n: number) => string;
  locale: string;
  onUseAccount: (a: XeroAccountOption) => void;
  adjustment: ReactNode;
}) {
  const asOf = data?.asOf ?? (startDate ? dayBefore(startDate) : "");
  const day = dayText(asOf, locale);
  const start = dayText(startDate, locale);
  const noValue = !!data && !data.pending && !data.consl;
  const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${money(Math.abs(n))}`;

  const conslFigure = loading
    ? { value: "…", sub: "Reading…" }
    : data?.pending
      ? { value: "—", sub: `Read at the end of ${day}` }
      : data?.consl
        ? { value: money(data.consl.total), sub: `Materials ${money(data.consl.raw)} · In production ${money(data.consl.inProduction)} · Finished ${money(data.consl.finished)}` }
        : { value: "No value", sub: data?.firstDay && data.firstDay > asOf ? `consl's stock history starts ${dayText(data.firstDay, locale)}` : "consl has no stock value for that day", warn: true };
  const xeroFigure = loading
    ? { value: "…", sub: "Reading…" }
    : data?.pending
      ? { value: "—", sub: `Read at the end of ${day}` }
      : data?.xero.reconnect
        ? { value: "—", sub: "Reconnect Xero to read it", warn: true }
      : data?.xero.newAccount
        ? { value: money(0), sub: "A new account: nothing in it yet" }
        : error || data?.xero.error
          ? { value: "—", sub: "Couldn't read Xero", warn: true }
          : { value: money(data?.xero.balance ?? 0), sub: inventoryName };
  const others = data?.xero.newAccount ? (data.xero.others ?? []) : [];
  const diffFigure =
    diff === null
      ? { value: "—", sub: data?.pending ? "Worked out once that day is over" : "" }
      : diff === 0
        ? { value: money(0), sub: "Xero already matches consl" }
        : { value: signed(diff), sub: diff > 0 ? "consl's value is higher" : "consl's value is lower" };

  const matchText =
    noValue || data?.xero.reconnect
      ? `consl adds one adjustment on ${start} so Xero's inventory matches consl's stock value.`
      : data?.pending
        ? `consl reads both numbers at the end of ${day}, then adds one adjustment on ${start} so Xero's inventory matches consl.`
        : diff === 0
          ? "Xero already matches consl on that day. Nothing to adjust."
          : diff !== null && diff > 0
            ? `On ${start}, consl adds ${money(diff)} to Xero's inventory so it matches consl. The same amount lowers your costs that month, in the account below.`
            : diff !== null
              ? `On ${start}, consl takes ${money(-diff)} off Xero's inventory so it matches consl. The same amount is a cost that month, in the account below.`
              : `On ${start}, consl adds one adjustment so Xero's inventory matches consl. The difference shows in that month's P&L, in the account below.`;

  return (
    <section className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
      <div className="px-5 py-4">
        <h2 className="text-[15px] font-semibold text-ink">Starting inventory</h2>
        <p className="mt-0.5 text-[12.5px] text-muted">
          What your inventory is worth in Xero when consl starts sending, next to consl&apos;s stock value. Both are at the end of {day || "the day before your start date"}, the day before you start.
        </p>
      </div>
      <div className="grid gap-px border-t border-line bg-line sm:grid-cols-3">
        {[
          { label: "consl's stock value", ...conslFigure },
          { label: "Xero's inventory", ...xeroFigure },
          { label: "Difference", ...diffFigure },
        ].map((f) => (
          <div key={f.label} className="min-w-0 bg-surface px-5 py-3">
            <div className="text-[11.5px] text-muted">{f.label}</div>
            <div className={`mt-0.5 text-[17px] font-semibold tabular-nums ${"warn" in f && f.warn ? "text-warn" : "text-ink"}`}>{f.value}</div>
            {f.sub && <div className="mt-0.5 text-[11.5px] leading-snug text-muted">{f.sub}</div>}
          </div>
        ))}
      </div>
      {others.length > 0 && (
        <div className="border-t border-line px-4 pt-3">
          <div className="rounded-xl border border-warn/30 bg-warn/10 px-3 py-2.5">
            <p className="flex items-start gap-1.5 text-[12.5px] font-medium leading-snug text-warn">
              <AlertTriangle size={13} className="mt-[2px] shrink-0" />
              Your Xero already has stock in {others.length === 1 ? "an inventory account" : "inventory accounts"}
            </p>
            <ul className="mt-1.5 space-y-1">
              {others.map((a) => (
                <li key={a.accountId} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ink">
                  <span className="min-w-0 truncate">
                    {a.code ? `${a.code} · ` : ""}
                    {a.name}: <span className="tabular-nums">{money(a.balance)}</span> on {day}
                  </span>
                  {!disabled && (
                    <button type="button" onClick={() => onUseAccount(a)} className="rounded-md border border-border bg-surface px-2 py-0.5 text-[11.5px] font-medium text-ink-soft hover:bg-surface-2">
                      Use this account
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-[12px] leading-snug text-muted">
              consl is set to put your stock in a new account, so that stock would be counted twice. Use your existing account instead (it becomes your Inventory account in the balance sheet below).
            </p>
          </div>
        </div>
      )}
      <div className="space-y-2 border-t border-line p-4" role="radiogroup" aria-label="Starting inventory">
        <div className={`overflow-hidden rounded-xl border transition-colors ${choice === "match" ? "border-accent/50 bg-accent-soft/30" : "border-border"}`}>
          <button type="button" role="radio" aria-checked={choice === "match"} disabled={disabled} onClick={() => onChoice("match")} className="flex w-full items-start gap-2.5 px-3.5 py-3 text-left disabled:cursor-default">
            <Radio on={choice === "match"} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
                Match consl&apos;s value <span className={`${PILL} pill-chart`}>Recommended</span>
              </span>
              <span className="mt-0.5 block text-[12.5px] leading-snug text-muted">{matchText}</span>
            </span>
          </button>
          {choice === "match" && (noValue || data?.xero.reconnect || (!data?.xero.newAccount && (error || data?.xero.error))) && (
            <div className="-mt-1.5 flex items-start gap-1.5 pb-3 pl-[40px] pr-3.5 text-[12px] leading-snug text-warn">
              <AlertTriangle size={12} className="mt-[2px] shrink-0" />
              {noValue ? (
                <span>
                  consl has no stock value for {day}
                  {data?.firstDay && data.firstDay > asOf ? ` (its stock history starts ${dayText(data.firstDay, locale)})` : ""}. Pick a later start date, or keep Xero&apos;s number.
                </span>
              ) : data?.xero.reconnect ? (
                <span>
                  consl needs one more permission from Xero to read your inventory there.{" "}
                  <a href="/api/integrations/xero/connect" className="font-medium underline underline-offset-2">
                    Reconnect Xero
                  </a>{" "}
                  (your setup stays as it is), or keep Xero&apos;s number.
                </span>
              ) : (
                <span>Couldn&apos;t read your inventory in Xero: {error ?? data?.xero.error}</span>
              )}
            </div>
          )}
          {choice === "match" && !noValue && !data?.xero.reconnect && <div className="mx-3 mb-3 rounded-lg border border-border bg-surface">{adjustment}</div>}
        </div>
        <div className={`rounded-xl border transition-colors ${choice === "keep" ? "border-accent/50 bg-accent-soft/30" : "border-border"}`}>
          <button type="button" role="radio" aria-checked={choice === "keep"} disabled={disabled} onClick={() => onChoice("keep")} className="flex w-full items-start gap-2.5 px-3.5 py-3 text-left disabled:cursor-default">
            <Radio on={choice === "keep"} />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium text-ink">Keep Xero&apos;s number</span>
              <span className="mt-0.5 block text-[12.5px] leading-snug text-muted">
                Xero&apos;s inventory stays as it is. Pick this if your Xero number is already right, for example from a stock count on that day.
              </span>
            </span>
          </button>
        </div>
        <p className="px-1 text-[11.5px] text-muted">Either way, from {start || "your start date"} on, the number moves with your stock bills and consl&apos;s monthly journals.</p>
      </div>
    </section>
  );
}

function Radio({ on }: { on: boolean }) {
  return (
    <span className={`mt-[2px] grid h-4 w-4 shrink-0 place-items-center rounded-full border transition-colors ${on ? "border-accent" : "border-border"}`}>
      {on && <span className="h-2 w-2 rounded-full bg-accent" />}
    </span>
  );
}

/** "Oct 2, 3:14 PM" for a moment. */
function when(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** The first journal's window in words: "March 2026", or "Mar 18 – Mar 31, 2026 (partial month)". */
function firstJournal(start: string, locale: string): string {
  if (!start) return "";
  const fmt = (day: string, o: Intl.DateTimeFormatOptions) => new Date(`${day}T00:00:00Z`).toLocaleDateString(locale, { ...o, timeZone: "UTC" });
  if (start.endsWith("-01")) return `First journal: ${fmt(start, { month: "long", year: "numeric" })}`;
  return `First journal: ${fmt(start, { month: "short", day: "numeric" })} – ${fmt(monthEnd(start), { month: "short", day: "numeric", year: "numeric" })} (partial month)`;
}
