"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { SelectMenu, type SelectMenuOption } from "@/components/SelectMenu";
import { AlertTriangle, ArrowRight, Check, Plus, X } from "@/components/icons";
import { ROOT_LOGO } from "@/lib/channel-logos";
import { saveXeroSetupAction } from "@/app/(app)/pnl/xero/actions";
import type { XeroSetupScreen } from "@/lib/xero-setup";
import {
  CHANNEL_NAME,
  LINES,
  SECTIONS,
  XERO_TYPE_LABEL,
  lineRowKey,
  targetValue,
  type LineKey,
  type XeroChannel,
  type XeroTarget,
} from "@/lib/xero-setup-shared";

/**
 * The Xero export's setup screen: which Xero account every line of the company's consl P&L goes
 * to, and where the money waits on the balance sheet. Everything is staged and only reaches Xero
 * on Save (new accounts are listed for confirmation first).
 */
export function XeroSetupClient({ data, canEdit }: { data: XeroSetupScreen; canEdit: boolean }) {
  const router = useRouter();
  const [same, setSame] = useState(data.sameForAllChannels);
  const [tab, setTab] = useState<XeroChannel>(data.channels[0]);
  const [targets, setTargets] = useState<Record<string, XeroTarget>>(data.targets);
  const [tag, setTag] = useState(data.tagChannels);
  const [start, setStart] = useState(data.startMonth);
  const snapshot = (s: { same: boolean; targets: Record<string, XeroTarget>; tag: boolean; start: string }) =>
    JSON.stringify({ same: s.same, tag: s.tag, start: s.start, t: Object.entries(s.targets).map(([k, v]) => [k, targetValue(v)]).sort() });
  const [baseline, setBaseline] = useState(() => snapshot({ same: data.sameForAllChannels, targets: data.targets, tag: data.tagChannels, start: data.startMonth }));
  const [savedOnce, setSavedOnce] = useState(Boolean(data.savedAt));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const dirty = snapshot({ same, targets, tag, start }) !== baseline;

  // Which channels feed each line, for the "same for every channel" view.
  const channelsOf = useMemo(() => {
    const m = new Map<LineKey, XeroChannel[]>();
    for (const { channel, line } of data.lines) m.set(line, [...(m.get(line) ?? []), channel]);
    return m;
  }, [data.lines]);

  const accountOptions: SelectMenuOption[] = useMemo(
    () =>
      data.accounts.map((a) => ({
        value: `acc:${a.accountId}`,
        label: a.code ? `${a.code} · ${a.name}` : a.name,
        hint: XERO_TYPE_LABEL[a.type] ?? a.type,
      })),
    [data.accounts],
  );

  /** A row's choices: its suggested new account (and any other new one it currently holds), then Xero's chart. */
  function optionsFor(suggested: { name: string; type: string }, current: XeroTarget | null): SelectMenuOption[] {
    const news = [{ name: suggested.name, type: suggested.type }];
    if (current?.kind === "new" && !news.some((n) => n.name === current.name && n.type === current.type)) news.unshift({ name: current.name, type: current.type });
    // An account the page hasn't reloaded yet (just created by a save) still shows by name.
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
      const a = data.accounts.find((x) => x.accountId === value.slice(4));
      return a ? { kind: "account", ...a } : null;
    }
    if (value.startsWith("new:")) {
      const rest = value.slice(4);
      const i = rest.indexOf(":");
      return { kind: "new", type: rest.slice(0, i), name: rest.slice(i + 1) };
    }
    return null;
  }

  function setRows(keys: string[], value: string) {
    const t = decode(value);
    if (!t) return;
    setTargets((prev) => {
      const next = { ...prev };
      for (const k of keys) next[k] = t;
      return next;
    });
    setNotice(null);
  }

  // Distinct new accounts the current choices would create.
  const newAccounts = useMemo(() => {
    const seen = new Map<string, { name: string; type: string }>();
    for (const t of Object.values(targets)) if (t.kind === "new") seen.set(`${t.type}|${t.name.toLowerCase()}`, { name: t.name, type: t.type });
    return [...seen.values()];
  }, [targets]);

  async function save() {
    setConfirming(false);
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const r = await saveXeroSetupAction({ targets, sameForAllChannels: same, tagChannels: tag, startMonth: start });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setTargets(r.targets);
      setBaseline(snapshot({ same, targets: r.targets, tag, start }));
      setSavedOnce(true);
      setNotice(
        r.created.length
          ? `Saved. ${r.created.length} new ${r.created.length === 1 ? "account was" : "accounts were"} added to ${data.orgName} in Xero.`
          : "Saved.",
      );
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Reload to check whether it was saved.");
    } finally {
      setPending(false);
    }
  }

  function discard() {
    setSame(data.sameForAllChannels);
    setTargets(data.targets);
    setTag(data.tagChannels);
    setStart(data.startMonth);
    setError(null);
  }

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
              return (
                <MappingRow
                  key={`${line}:${channels.join(",")}`}
                  label={LINES[line].label}
                  hint={LINES[line].hint}
                  logos={same ? channels : []}
                  stale={rowKeys.some((k) => data.stale.includes(k))}
                  value={shared ? targetValue(shared) : ""}
                  placeholder="Varies by channel"
                  options={optionsFor({ name: LINES[line].suggest.names[0], type: LINES[line].suggest.type }, shared)}
                  isNew={shared?.kind === "new"}
                  disabled={!canEdit || pending}
                  onChange={(v) => setRows(rowKeys, v)}
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
            <p className="mt-0.5 text-[12.5px] text-muted">The Xero account each line of your consl P&amp;L posts to.</p>
          </div>
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
                <ChannelMark channel={ch} />
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
          {data.balances.map((b) => (
            <MappingRow
              key={b.key}
              label={b.label}
              hint={b.hint}
              logos={b.channel ? [b.channel] : []}
              stale={data.stale.includes(b.key)}
              value={targetValue(targets[b.key])}
              placeholder="Pick an account"
              options={optionsFor({ name: b.suggest.names[0], type: b.suggest.type }, targets[b.key] ?? null)}
              isNew={targets[b.key]?.kind === "new"}
              disabled={!canEdit || pending}
              onChange={(v) => setRows([b.key], v)}
            />
          ))}
        </div>
      </section>

      {/* Options */}
      <section className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
        <div className="border-b border-line px-5 py-4">
          <h2 className="text-[15px] font-semibold text-ink">Options</h2>
        </div>
        <div className="divide-y divide-line">
          {data.channels.length > 0 && (
            <div className="flex items-center justify-between gap-6 px-5 py-4">
              <div className="min-w-0">
                <div className="text-[13.5px] font-medium text-ink">Tag lines by sales channel</div>
                <div className="mt-0.5 text-[12px] text-muted">Adds a &ldquo;Sales channel&rdquo; tracking category in Xero, so you can read the P&amp;L per channel there too.</div>
              </div>
              <Switch checked={tag} onChange={setTag} disabled={!canEdit || pending} label="Tag lines by sales channel" />
            </div>
          )}
          <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
            <div className="min-w-0">
              <div className="text-[13.5px] font-medium text-ink">First month to send</div>
              <div className="mt-0.5 text-[12px] text-muted">Earlier months stay as they are in Xero. Each month is sent once it&apos;s complete.</div>
            </div>
            <SelectMenu value={start} onChange={setStart} options={data.months} ariaLabel="First month to send" className="w-full sm:w-[220px]" disabled={!canEdit || pending} />
          </div>
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
                disabled={pending}
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
            <ul className="mt-3 divide-y divide-line rounded-xl border border-border">
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
  logos,
  stale,
  value,
  placeholder,
  options,
  isNew,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  logos: XeroChannel[];
  stale: boolean;
  value: string;
  placeholder: string;
  options: SelectMenuOption[];
  isNew: boolean;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid gap-2.5 px-5 py-3.5 sm:grid-cols-[minmax(0,1fr)_16px_minmax(0,340px)] sm:items-center sm:gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13.5px] font-medium text-ink">{label}</span>
          {logos.length > 0 && (
            <span className="flex items-center gap-1" title={logos.map((c) => CHANNEL_NAME[c]).join(", ")}>
              {logos.map((c) => (
                <ChannelMark key={c} channel={c} />
              ))}
            </span>
          )}
          {isNew && <span className="pill-chart inline-flex items-center rounded-full border px-1.5 py-[1px] text-[10.5px] font-medium">New</span>}
        </div>
        <div className="mt-0.5 text-[12px] leading-snug text-muted">{hint}</div>
        {stale && (
          <div className="mt-1 inline-flex items-center gap-1 text-[11.5px] text-warn">
            <AlertTriangle size={11} /> The account saved here is gone from Xero. Pick another.
          </div>
        )}
      </div>
      <ArrowRight size={14} className="hidden text-muted sm:block" />
      <SelectMenu value={value} onChange={onChange} options={options} placeholder={placeholder} ariaLabel={`Xero account for ${label}`} disabled={disabled} />
    </div>
  );
}

function ChannelMark({ channel }: { channel: XeroChannel }) {
  return (
    <span className="grid h-[18px] w-[18px] place-items-center overflow-hidden rounded-[5px] border border-border bg-white p-[2px]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={ROOT_LOGO[channel]} alt="" className="max-h-full max-w-full object-contain" />
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
