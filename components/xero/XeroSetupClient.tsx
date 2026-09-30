"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SelectMenu, type SelectMenuOption } from "@/components/SelectMenu";
import { DatePicker } from "@/components/DatePicker";
import { HoverHint } from "@/components/HoverHint";
import { useMoney } from "@/components/CurrencyProvider";
import { AlertTriangle, ArrowRight, Check, Info, Pencil, Plus, RefreshCw, X } from "@/components/icons";
import { ROOT_LOGO, SOURCE_LOGO } from "@/lib/channel-logos";
import { saveXeroSetupAction } from "@/app/(app)/pnl/xero/actions";
import type { XeroSetupScreen } from "@/lib/xero-setup";
import {
  CHANNEL_NAME,
  LINES,
  SECTIONS,
  XERO_TYPE_LABEL,
  lineRowKey,
  monthEnd,
  newAccountName,
  targetValue,
  type LineKey,
  type XeroAccountOption,
  type XeroChannel,
  type XeroTarget,
} from "@/lib/xero-setup-shared";

type Mark = { key: string; src: string; title: string };

const norm = (s: string) => s.trim().toLowerCase();
/** Re-read the Xero chart when the tab comes back into view, at most this often. */
const REFRESH_EVERY_MS = 20_000;

/**
 * The Xero export's setup screen: which Xero account every line of the company's consl P&L goes
 * to, and where the money waits on the balance sheet. consl proposes a new account for every row
 * ("consl - …", renamable), or the owner picks one already in Xero. Everything is staged and only
 * reaches Xero on Save (new accounts are listed for confirmation first).
 */
export function XeroSetupClient({ data, canEdit }: { data: XeroSetupScreen; canEdit: boolean }) {
  const router = useRouter();
  const { locale } = useMoney();
  const [same, setSame] = useState(data.sameForAllChannels);
  const [tab, setTab] = useState<XeroChannel>(data.channels[0]);
  const [staged, setStaged] = useState<Record<string, XeroTarget>>(data.targets);
  const [tag, setTag] = useState(data.tagChannels);
  const [start, setStart] = useState(data.startDate);
  const [accounts, setAccounts] = useState<XeroAccountOption[]>(data.accounts);
  const [conslMade, setConslMade] = useState<string[]>(data.conslMade);
  const [refreshing, setRefreshing] = useState(false);
  const lastRead = useRef(0);
  const snapshot = (s: { same: boolean; targets: Record<string, XeroTarget>; tag: boolean; start: string }) =>
    JSON.stringify({ same: s.same, tag: s.tag, start: s.start, t: Object.entries(s.targets).map(([k, v]) => [k, targetValue(v)]).sort() });
  const [baseline, setBaseline] = useState(() => snapshot({ same: data.sameForAllChannels, targets: data.targets, tag: data.tagChannels, start: data.startDate }));
  const [savedOnce, setSavedOnce] = useState(Boolean(data.savedAt));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const existingByName = useMemo(() => new Map(accounts.map((a) => [norm(a.name), a])), [accounts]);
  // A "new" account named like one consl already made in this Xero organisation IS that account
  // (a save that stopped halfway made it): the row shows it, and saving reuses it.
  const targets = useMemo(() => {
    const ours = new Set(conslMade);
    const out: Record<string, XeroTarget> = {};
    for (const [k, t] of Object.entries(staged)) {
      const acc = t.kind === "new" ? existingByName.get(norm(t.name)) : undefined;
      out[k] = acc && ours.has(acc.accountId) ? { kind: "account", ...acc } : t;
    }
    return out;
  }, [staged, existingByName, conslMade]);
  /** For a new account: the company's own account that already has its name (Xero names are unique). */
  const clashOf = (t: XeroTarget | null | undefined) => (t?.kind === "new" ? (existingByName.get(norm(t.name)) ?? null) : null);

  const dirty = snapshot({ same, targets, tag, start }) !== baseline;

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

  // Which channels feed each line, for the "same for every channel" view.
  const channelsOf = useMemo(() => {
    const m = new Map<LineKey, XeroChannel[]>();
    for (const { channel, line } of data.lines) m.set(line, [...(m.get(line) ?? []), channel]);
    return m;
  }, [data.lines]);

  const accountOptions: SelectMenuOption[] = useMemo(
    () =>
      accounts.map((a) => ({
        value: `acc:${a.accountId}`,
        label: a.code ? `${a.code} · ${a.name}` : a.name,
        hint: XERO_TYPE_LABEL[a.type] ?? a.type,
      })),
    [accounts],
  );
  /** A row's choices: a new account (its current name, or consl's), then Xero's chart. */
  function optionsFor(suggested: { name: string; type: string }, current: XeroTarget | null): SelectMenuOption[] {
    const news = current?.kind === "new" ? [{ name: current.name, type: current.type }] : [];
    // A new account is always on offer, under a name that's still free in Xero ("… 2" once consl's is taken).
    let name = suggested.name;
    for (let i = 2; existingByName.has(norm(name)) && i < 100; i++) name = `${suggested.name} ${i}`;
    if (!news.some((n) => norm(n.name) === norm(name))) news.push({ name, type: suggested.type });
    // An account the list hasn't caught up with yet (just created by a save) still shows by name.
    const extra: SelectMenuOption[] =
      current?.kind === "account" && !accountOptions.some((o) => o.value === `acc:${current.accountId}`)
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
      ...accountOptions,
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

  function setRows(keys: string[], t: XeroTarget | null) {
    if (!t) return;
    setStaged((prev) => {
      const next = { ...prev };
      for (const k of keys) next[k] = t;
      return next;
    });
    setNotice(null);
  }

  // New accounts the current choices would create, and names that are already taken in Xero.
  const { newAccounts, clashes } = useMemo(() => {
    const seen = new Map<string, { name: string; type: string }>();
    const taken = new Set<string>();
    for (const t of Object.values(targets)) {
      if (t.kind !== "new") continue;
      if (existingByName.has(norm(t.name))) taken.add(norm(t.name));
      else seen.set(`${t.type}|${norm(t.name)}`, { name: t.name.trim(), type: t.type });
    }
    return { newAccounts: [...seen.values()], clashes: taken.size };
  }, [targets, existingByName]);

  async function save() {
    setConfirming(false);
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const r = await saveXeroSetupAction({ targets, sameForAllChannels: same, tagChannels: tag, startDate: start });
      if (!r.ok) {
        setError(r.error);
        // Accounts made before it stopped are real now: show them, so a retry picks them up.
        if (r.settled) setStaged((prev) => ({ ...prev, ...r.settled }));
        void refreshAccounts(true);
        return;
      }
      setStaged(r.targets);
      setBaseline(snapshot({ same, targets: r.targets, tag, start }));
      setSavedOnce(true);
      setNotice(
        r.created.length
          ? `Saved. ${r.created.length} new ${r.created.length === 1 ? "account was" : "accounts were"} added to ${data.orgName} in Xero.`
          : "Saved.",
      );
      router.refresh();
      void refreshAccounts(true);
    } catch {
      setError("Couldn't reach the server. Reload to check whether it was saved.");
    } finally {
      setPending(false);
    }
  }

  function discard() {
    setSame(data.sameForAllChannels);
    setStaged(data.targets);
    setTag(data.tagChannels);
    setStart(data.startDate);
    setError(null);
  }

  const channelMarks = (channels: XeroChannel[]): Mark[] => channels.map((c) => ({ key: c, src: ROOT_LOGO[c], title: CHANNEL_NAME[c] }));
  // Custom fees come from consl itself (fees and credits added to orders), as on the P&L.
  const marksFor = (line: LineKey, channels: XeroChannel[]): Mark[] =>
    line === "custom_fees" ? [{ key: "consl", src: SOURCE_LOGO.CONSL, title: "Added in consl" }] : same ? channelMarks(channels) : [];

  const lineRows = (keys: { line: LineKey; channels: XeroChannel[] }[]) =>
    SECTIONS.map((section) => {
      const rows = keys.filter((k) => LINES[k.line].section === section.key);
      if (!rows.length) return null;
      return (
        <div key={section.key}>
          <div className="px-5 pb-1 pt-5 text-[11px] font-medium uppercase tracking-[0.07em] text-muted">{section.label}</div>
          <div className="divide-y divide-line">
            {rows.map(({ line, channels }) => {
              const rowKeys = channels.map((ch) => lineRowKey(ch, line));
              const values = rowKeys.map((k) => targetValue(targets[k]));
              const shared = values.every((v) => v === values[0]) ? targets[rowKeys[0]] : null;
              const base = LINES[line].suggest;
              const suggestedName = newAccountName(!same && channels.length === 1 ? `${CHANNEL_NAME[channels[0]]} ${base.name}` : base.name);
              return (
                <MappingRow
                  key={`${line}:${channels.join(",")}`}
                  label={LINES[line].label}
                  hint={LINES[line].hint}
                  marks={marksFor(line, channels)}
                  stale={rowKeys.some((k) => data.stale.includes(k))}
                  target={shared}
                  placeholder="Varies by channel"
                  options={optionsFor({ name: suggestedName, type: base.type }, shared)}
                  clash={clashOf(shared)}
                  disabled={!canEdit || pending}
                  onPick={(v) => setRows(rowKeys, decode(v))}
                  onRename={(name) => shared?.kind === "new" && setRows(rowKeys, { kind: "new", type: shared.type, name })}
                />
              );
            })}
          </div>
        </div>
      );
    });

  const allLines = [...channelsOf.entries()].map(([line, channels]) => ({ line, channels }));
  const tabLines = data.lines.filter((l) => l.channel === tab).map((l) => ({ line: l.line, channels: [l.channel] }));

  return (
    <div className="space-y-5">
      {notice && (
        <div className="flex items-center gap-2 rounded-lg border border-positive/25 bg-positive/10 px-3 py-2 text-[12.5px] text-positive">
          <Check size={14} /> {notice}
        </div>
      )}

      <HowItWorks />

      {/* P&L lines */}
      <section className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">P&amp;L lines</h2>
            <p className="mt-0.5 text-[12.5px] text-muted">
              The Xero account each line of your consl P&amp;L posts to. consl proposes a new one for each; rename it or pick one of yours.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void refreshAccounts(false)}
              disabled={refreshing}
              title="Read your Xero chart of accounts again"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[12px] text-ink-soft hover:bg-surface-2 disabled:opacity-60"
            >
              <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
              {refreshing ? "Reading Xero…" : "Refresh accounts"}
            </button>
            {data.channels.length > 1 && (
              <div role="tablist" aria-label="Accounts per channel" className="flex h-8 items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5">
                {[
                  { v: true, label: "Same for every channel" },
                  { v: false, label: "Per channel" },
                ].map((o) => (
                  <button
                    key={String(o.v)}
                    type="button"
                    role="tab"
                    aria-selected={same === o.v}
                    disabled={!canEdit}
                    onClick={() => setSame(o.v)}
                    className={`flex h-full items-center rounded-md px-2.5 text-[12px] transition-colors disabled:cursor-default ${same === o.v ? "bg-surface-2 font-medium text-ink" : "text-muted hover:text-ink-soft"}`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Options for the whole export, right under the chart controls. */}
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-line bg-surface-2/40 px-5 py-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
            <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-ink">
              Start sending from
              <HoverHint
                title="Start date"
                body="consl sends everything from this day on, one journal per channel for each month, once the month is over. If you don't start on the 1st, the first journal covers the rest of that month only. Anything before this day stays as it is in Xero."
              />
            </span>
            <DatePicker value={start} onChange={(d) => d && setStart(d)} fullWidth={false} className="w-[150px]" disabled={!canEdit || pending} />
            <span className="text-[12px] text-muted">{firstJournal(start, locale)}</span>
          </div>
          {data.channels.length > 0 && (
            <div className="inline-flex items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-ink">
                Tag lines by sales channel
                <HoverHint
                  title="Sales channel tags"
                  body="Adds a “Sales channel” tracking category in Xero and tags every line with Amazon, Shopify or TikTok Shop, so you can read the P&L per channel in Xero too."
                />
              </span>
              <Switch checked={tag} onChange={setTag} disabled={!canEdit || pending} label="Tag lines by sales channel" />
            </div>
          )}
        </div>

        {!same && (
          <div className="flex flex-wrap gap-1.5 border-b border-line px-5 py-3">
            {data.channels.map((ch) => (
              <button
                key={ch}
                type="button"
                onClick={() => setTab(ch)}
                className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[12.5px] transition-colors ${
                  tab === ch ? "border-ink/20 bg-surface-2 font-medium text-ink" : "border-border text-ink-soft hover:bg-surface-2"
                }`}
              >
                <MarkTile src={ROOT_LOGO[ch]} />
                {CHANNEL_NAME[ch]}
              </button>
            ))}
          </div>
        )}

        <div className="pb-2">{lineRows(same ? allLines : tabLines)}</div>
      </section>

      {/* Balance sheet */}
      <section className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
        <div className="border-b border-line px-5 py-4">
          <h2 className="text-[15px] font-semibold text-ink">Balance sheet</h2>
          <p className="mt-0.5 text-[12.5px] text-muted">
            Where the money waits until cash moves. When a payout or card charge reaches your bank, code it to the matching account below.
          </p>
        </div>
        <div className="divide-y divide-line pb-1">
          {data.balances.map((b) => {
            const t = targets[b.key] ?? null;
            return (
              <MappingRow
                key={b.key}
                label={b.label}
                hint={b.hint}
                marks={b.channel ? channelMarks([b.channel]) : []}
                stale={data.stale.includes(b.key)}
                target={t}
                placeholder="Pick an account"
                options={optionsFor({ name: newAccountName(b.suggest.name), type: b.suggest.type }, t)}
                clash={clashOf(t)}
                disabled={!canEdit || pending}
                onPick={(v) => setRows([b.key], decode(v))}
                onRename={(name) => t?.kind === "new" && setRows([b.key], { kind: "new", type: t.type, name })}
              />
            );
          })}
        </div>
      </section>

      {!canEdit && <p className="text-[12.5px] text-muted">Only people who can edit settings can change this setup.</p>}

      {/* Save bar: staged changes reach Xero only from here. */}
      {canEdit && (dirty || !savedOnce || error) && (
        <div className="sticky bottom-4 z-20">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface/95 px-4 py-3 shadow-lg backdrop-blur">
            <div className="min-w-0 text-[12.5px]">
              {error ? (
                <span className="inline-flex items-center gap-1.5 text-negative">
                  <AlertTriangle size={13} /> {error}
                </span>
              ) : clashes ? (
                <span className="inline-flex items-center gap-1.5 text-negative">
                  <AlertTriangle size={13} /> {clashes === 1 ? "One new account has a name" : `${clashes} new accounts have names`} already used in Xero. Rename{" "}
                  {clashes === 1 ? "it" : "them"}, or pick the existing account.
                </span>
              ) : newAccounts.length ? (
                <span className="text-ink-soft">
                  <span className="font-medium text-ink">{newAccounts.length}</span> new {newAccounts.length === 1 ? "account" : "accounts"} will be added to Xero when you save.
                </span>
              ) : !savedOnce ? (
                <span className="text-ink-soft">Nothing is sent to Xero until you save this setup.</span>
              ) : (
                <span className="text-ink-soft">You have unsaved changes.</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {dirty && (
                <button type="button" onClick={discard} disabled={pending} className="rounded-lg px-3 py-2 text-[12.5px] font-medium text-muted hover:text-ink-soft disabled:opacity-50">
                  Discard
                </button>
              )}
              <button
                type="button"
                disabled={pending || clashes > 0}
                onClick={() => (newAccounts.length ? setConfirming(true) : save())}
                className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-bg hover:opacity-90 disabled:opacity-50"
              >
                {pending ? "Saving…" : "Save setup"}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setConfirming(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Add accounts to Xero"
            className="org-pop w-full max-w-md rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-[15px] font-semibold text-ink">
                Add {newAccounts.length} {newAccounts.length === 1 ? "account" : "accounts"} to Xero?
              </h3>
              <button type="button" onClick={() => setConfirming(false)} aria-label="Close" className="text-muted hover:text-ink">
                <X size={18} />
              </button>
            </div>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
              These go into {data.orgName}&apos;s chart of accounts. Nothing else is posted yet.
            </p>
            <ul className="mt-3 max-h-[50vh] divide-y divide-line overflow-y-auto rounded-xl border border-border">
              {newAccounts.map((a) => (
                <li key={`${a.type}|${a.name}`} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
                  <span className="truncate text-ink">{a.name}</span>
                  <span className="shrink-0 text-[12px] text-muted">{XERO_TYPE_LABEL[a.type] ?? a.type}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirming(false)} className="rounded-lg border border-border px-3.5 py-2 text-[13px] text-ink-soft hover:bg-surface-2">
                Cancel
              </button>
              <button type="button" onClick={save} className="rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-bg hover:opacity-90">
                Add and save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MappingRow({
  label,
  hint,
  marks,
  stale,
  target,
  placeholder,
  options,
  clash,
  disabled,
  onPick,
  onRename,
}: {
  label: string;
  hint: string;
  marks: Mark[];
  stale: boolean;
  target: XeroTarget | null;
  placeholder: string;
  options: SelectMenuOption[];
  /** For a new account: the company's account that already has its name (it can't be created). */
  clash: XeroAccountOption | null;
  disabled: boolean;
  onPick: (v: string) => void;
  onRename: (name: string) => void;
}) {
  const isNew = target?.kind === "new";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  function startRename() {
    if (target?.kind !== "new") return;
    setDraft(target.name);
    setEditing(true);
  }
  function commit() {
    const name = draft.trim().slice(0, 150);
    if (name) onRename(name);
    setEditing(false);
  }

  return (
    <div className="grid gap-2.5 px-5 py-3.5 sm:grid-cols-[minmax(0,1fr)_16px_minmax(0,340px)] sm:items-center sm:gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13.5px] font-medium text-ink">{label}</span>
          {marks.length > 0 && (
            <span className="flex items-center gap-1" title={marks.map((m) => m.title).join(", ")}>
              {marks.map((m) => (
                <MarkTile key={m.key} src={m.src} />
              ))}
            </span>
          )}
          {isNew && (
            <HoverHint
              title="New account"
              body="consl adds this account to your Xero chart of accounts when you save. Rename it with the pencil, or pick one of your own Xero accounts from the list instead."
              className="rounded-full"
            >
              <span className="pill-chart inline-flex items-center gap-1 rounded-full border py-[1px] pl-1.5 pr-1 text-[10.5px] font-medium">
                New account
                <Info size={11} />
              </span>
            </HoverHint>
          )}
        </div>
        <div className="mt-0.5 text-[12px] leading-snug text-muted">{hint}</div>
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
      <ArrowRight size={14} className="hidden text-muted sm:block" />
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
            aria-label={`Name of the new account for ${label}`}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none"
          />
        </div>
      ) : (
        <div className="flex min-w-0 items-center gap-1.5">
          <div className="min-w-0 flex-1">
            <SelectMenu
              value={target ? targetValue(target) : ""}
              onChange={onPick}
              options={options}
              placeholder={placeholder}
              ariaLabel={`Xero account for ${label}`}
              disabled={disabled}
            />
          </div>
          {isNew && !disabled && (
            <button
              type="button"
              onClick={startRename}
              aria-label={`Rename the new account for ${label}`}
              title="Rename"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-border text-muted transition-colors hover:border-ink/25 hover:text-ink"
            >
              <Pencil size={14} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function MarkTile({ src }: { src: string }) {
  return (
    <span className="grid h-[18px] w-[18px] place-items-center overflow-hidden rounded-[5px] border border-border bg-white p-[2px]">
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
    { title: "Match your lines", text: "Each line of your consl P&L goes to an account in your Xero chart." },
    { title: "Monthly journals", text: "When a month is complete, consl sends one journal per channel, dated when things happened." },
    { title: "Payouts clear", text: "Code each payout deposit to its channel's clearing account, and it balances out." },
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

/** The first journal's window in words: "March 2026", or "Mar 18 – Mar 31, 2026 (partial month)". */
function firstJournal(start: string, locale: string): string {
  if (!start) return "";
  const fmt = (day: string, o: Intl.DateTimeFormatOptions) => new Date(`${day}T00:00:00Z`).toLocaleDateString(locale, { ...o, timeZone: "UTC" });
  if (start.endsWith("-01")) return `First journal: ${fmt(start, { month: "long", year: "numeric" })}`;
  return `First journal: ${fmt(start, { month: "short", day: "numeric" })} – ${fmt(monthEnd(start), { month: "short", day: "numeric", year: "numeric" })} (partial month)`;
}
