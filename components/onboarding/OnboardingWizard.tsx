"use client";

import { NAME_MAX } from "@/lib/format";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SignOutButton } from "@clerk/nextjs";
import { AppLogo } from "@/components/AppLogo";
import { OrgSwitcher } from "@/components/OrgSwitcher";
import { CurrencyProvider, useMoney } from "@/components/CurrencyProvider";
import { AccessProvider } from "@/components/AccessProvider";
import { CompanyEditor, type CompanyForEdit } from "@/components/CompanyEditor";
import { TimezoneSettings } from "@/components/TimezoneSettings";
import { IntegrationControls } from "@/components/IntegrationControls";
import { ChannelMappingClient } from "@/components/ChannelMappingClient";
import { SelectMenu } from "@/components/SelectMenu";
import { NewProductButton, NewMaterialButton } from "@/components/CreateButtons";
import { SkuAvatar, Card } from "@/components/ui";
import { LotEditor, type EditorLine } from "@/components/LotEditor";
import { TransactionInvoicesTable } from "@/components/TransactionInvoicesTable";
import type { InvoiceRow, LotOption } from "@/components/TransactionInvoiceForm";
import type { MaterialType } from "@/components/LotBom";
import { DatePicker } from "@/components/DatePicker";
import { Field, inputCls } from "@/components/FormKit";
import { HoverHint } from "@/components/HoverHint";
import { BATCH_HELP, BUFFER_HELP, FLOOR_HELP, LEAD_HELP, REORDER_TO_HELP, SHIP_HELP } from "@/lib/restock-help";
import { updateGlobalDefaults } from "@/app/inventory/actions";
import type { Defaults as ReorderDefaults } from "@/components/RestockDashboard";
import { FACILITY_TYPES } from "@/lib/facility-types";
import { Check, AlertTriangle, ChevronDown, ChevronLeft, Plus, X, Package, Lock, Pencil } from "@/components/icons";
import type { MyOrg } from "@/lib/orgs";
import { createFacility, saveFinishedOpenings, saveRawOpenings } from "@/app/facilities/actions";
import {
  advanceOnboarding,
  backToStep,
  completeOnboarding,
  createOnboardingLot,
  deleteOnboardingLot,
  deleteOnboardingFacility,
  deleteOnboardingMaterial,
  getOnboardingJob,
  jumpToOnboardingStep,
  retryOnboardingJob,
  saveOpeningCosts,
} from "@/app/onboarding/actions";
import { updateProduct } from "@/app/catalog/actions";
import type { OnboardingJob } from "@/lib/onboarding-jobs";
import Image from "next/image";
import { ROOT_LOGO } from "@/lib/channel-logos";
import { SEG } from "@/lib/segments";
import { deriveProduction, derivePayment, PRODUCTION_LABEL, PAYMENT_LABEL, DERIVED_PILL_CLS } from "@/lib/lot-status";

/** Mirror of lib/onboarding-jobs' rule (that module is server-only): a job that never reported
 *  back — the server restarted mid-way — stops counting as running after a generous window. */
function jobIsRunning(job: OnboardingJob | null): boolean {
  if (!job || job.finishedAt) return false;
  return Date.now() - new Date(job.startedAt).getTime() < Math.max(90_000, job.expectedSeconds * 6_000);
}

/** Which steps can't be worked on until the job's result is in: the mapping step needs the
 *  catalogue pull, the stock step needs stock (a pull includes it), Finish needs everything. */
function stepNeedsJob(step: number, job: OnboardingJob | null): boolean {
  if (!job) return false;
  if (step === 2) return job.kind === "pull";
  if (step === 3) return true;
  if (step === 6) return true;
  return false;
}

/** The mapping payload for the active channel tab — null when no channel is connected. */
export type WizardMapping = null | {
  channel: "SHOPIFY" | "AMAZON" | "TIKTOK";
  tabs: Array<{ key: string; title: string; logo: string }>;
  rows: Array<{
    id: string;
    title: string;
    sku: string | null;
    imageUrl: string | null;
    price: number | null;
    ignored: boolean;
    mapped: { id: string; code: string; name: string; imageUrl: string | null } | null;
    suggestion: { productId: string; confidence: "exact" | "similar" } | null;
  }>;
  pickerProducts: Array<{ id: string; code: string; name: string; imageUrl: string | null; takenExternalId: string | null }>;
  pendingByChannel: Record<string, number>;
};

type WizardProduct = { id: string; code: string; name: string; imageUrl: string | null; openingUnitCost: number | null };
/** A lot created in the wizard, prepared exactly as the lot page prepares its editor + costs. */
export type WizardLot = {
  id: string;
  lotNr: number;
  updatedAt: string;
  initial: { poNumber: string | null; poDateISO: string | null; facilityId: string; notes: string | null };
  initialLines: EditorLine[];
  skuTxnCounts: Record<string, number>;
  totalCog: number;
  invoices: InvoiceRow[];
};
type LotEditing = {
  lots: WizardLot[];
  lotOptions: LotOption[];
  suppliers: string[];
  categories: string[];
  skuImages: Record<string, string | null>;
  materialTypes: MaterialType[];
  nextLotNr: number;
};
type InProduction = { lots: number; units: number; value: number; rawConsumedByFacility: Record<string, number> };
type WizardFacility = { id: string; code: string; name: string; type: string; channel: string | null; locked: boolean };
type WizardMaterial = { id: string; code: string; name: string; unitLabel: string; skuSpecific: boolean };
/** `value` = units × the product's starting cost; null while that cost is still missing. */
type ChannelCount = { channel: string; label: string; skus: { code: string; units: number; value: number | null }[] };
type RawLine = { materialTypeId: string; productId: string | null; quantity: number; unitCost: number };

const STEPS = [
  "Your company",
  "Sales channels",
  "Products & costs",
  "Facilities & stock",
  "Materials & stock",
  "Production in progress",
  "Finish",
];

const panelCls = "rounded-[var(--radius-card)] border border-border bg-surface p-5";

/* ------------------------- Unsaved-changes bar (one per wizard) -------------------------
 * Every section with local edits registers itself here while dirty: a label for the bar's text
 * plus save/discard closures. The wizard renders ONE floating frosted bar for all of them, and
 * Continue refuses to move while anything is registered (the bar shakes instead). */
type DirtySection = { label: string; save: () => Promise<string | null>; discard: () => void };
type RegisterDirty = (id: string, s: DirtySection | null) => void;
const DirtyContext = createContext<RegisterDirty | null>(null);

/** Register this section on the wizard's unsaved bar whenever `dirty` is true. */
function useDirtySection(id: string, dirty: boolean, section: DirtySection) {
  const register = useContext(DirtyContext);
  const ref = useRef(section);
  ref.current = section;
  useEffect(() => {
    if (!register) return;
    register(id, dirty ? { label: ref.current.label, save: () => ref.current.save(), discard: () => ref.current.discard() } : null);
    return () => register(id, null);
  }, [register, id, dirty]);
}

/**
 * The onboarding wizard — a full-screen, locked setup flow. The current step lives on the
 * Organization row (the server validates every forward move), so closing the tab and coming back
 * resumes exactly where they left off. Nothing else in the app is reachable until Finish.
 */
export function OnboardingWizard(props: {
  step: number;
  /** Furthest step ever reached — the rail lets the user click back and forth within it. */
  maxStep: number;
  /** Per step: whether anything is actually saved there (drives the rail's lit/dim state). */
  stepHasContent: boolean[];
  company: CompanyForEdit;
  isOwner: boolean;
  caps: Record<string, string[]> | null;
  orgs: MyOrg[];
  currency: { symbol: string; locale: string; code: string };
  syncTz: string;
  providers: Array<{ key: string; label: string; blurb: string; logo: string; connected: boolean; canConnect: boolean }>;
  /** A channel connected since the wizard's last data pull — step 1 offers the pull again. */
  channelsPullPending: boolean;
  /** The background catalogue/stock job, as last written by the server. */
  job: OnboardingJob | null;
  mapping: WizardMapping;
  products: WizardProduct[];
  /** The company-wide reorder rules (floor, lead time, shipping, order size, batch) — set in step 2. */
  reorderDefaults: ReorderDefaults;
  facilities: WizardFacility[];
  channelCounts: ChannelCount[];
  materials: WizardMaterial[];
  finishedOpenings: Record<string, Record<string, number>>;
  rawOpenings: Record<string, RawLine[]>;
  /** Step 5: the lots created so far plus everything their editors and cost forms need. */
  lotEditing: LotEditing;
  /** What those lots have accumulated — the Finish widget's "In production" slice. */
  inProduction: InProduction;
}) {
  const router = useRouter();
  const step = props.step;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skipChannels, setSkipChannels] = useState(false);

  // ---- The background job: Continue never waits on it. While it runs, poll; when it lands,
  // refresh so the step shows what it fetched. Steps that need its result show a dialog. ----
  // The server's copy arrives with each render; polling keeps a fresher copy of the SAME job (or
  // a newer one started from the dialog's Retry) — whichever started last wins, no state syncing.
  const [polled, setPolled] = useState<OnboardingJob | null>(null);
  const job = polled && (!props.job || polled.startedAt >= props.job.startedAt) ? polled : props.job;
  const setJob = setPolled;
  const running = jobIsRunning(job);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(async () => {
      try {
        const latest = await getOnboardingJob();
        setJob(latest);
        if (!jobIsRunning(latest)) router.refresh();
      } catch {
        // a missed poll just waits for the next one
      }
    }, 1500);
    return () => clearInterval(id);
  }, [running, router]);
  const [dismissedJob, setDismissedJob] = useState<string | null>(null); // startedAt of a failed job the user waved off
  const jobFailed = !!job && !running && !!job.error;
  const showDialog = stepNeedsJob(step, job) && (running || (jobFailed && dismissedJob !== job!.startedAt));
  const warning = jobFailed ? job!.error : null;
  // The COG grid is lifted here so Continue can save it before the server validates it.
  const [cogDraft, setCogDraft] = useState<Record<string, string>>({});
  const cogValue = (p: WizardProduct) => cogDraft[p.id] ?? (p.openingUnitCost != null ? String(p.openingUnitCost) : "");

  const anyConnected = props.providers.some((p) => p.connected);
  const ownFacilities = props.facilities.filter((f) => !f.channel);

  // ---- The one floating unsaved-changes bar. Sections register while dirty; Continue is gated. ----
  const [dirtySections, setDirtySections] = useState<Record<string, DirtySection>>({});
  const registerDirty: RegisterDirty = useCallback((id, s) => {
    setDirtySections((prev) => {
      if (!s) {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return { ...prev, [id]: s };
    });
  }, []);

  async function saveCosts(): Promise<string | null> {
    const entries = props.products.map((p) => {
      const v = cogValue(p).trim();
      return { productId: p.id, cost: v === "" ? null : Number(v) };
    });
    try {
      const rs = await saveOpeningCosts(entries);
      if (!rs.ok) return rs.error;
      setCogDraft({});
      return null;
    } catch {
      return "Couldn't reach the server — try again.";
    }
  }
  const cogDirty = props.products.some(
    (p) => cogDraft[p.id] !== undefined && cogDraft[p.id] !== (p.openingUnitCost != null ? String(p.openingUnitCost) : ""),
  );
  const allDirty: Record<string, DirtySection> = {
    ...(cogDirty ? { costs: { label: "starting costs", save: saveCosts, discard: () => setCogDraft({}) } } : {}),
    ...dirtySections,
  };
  const dirtyCount = Object.keys(allDirty).length;

  const [barPending, setBarPending] = useState(false);
  const [barError, setBarError] = useState<string | null>(null);
  const [nudge, setNudge] = useState(0); // bump = replay the shake/attention animation

  async function saveAll() {
    setBarPending(true);
    setBarError(null);
    try {
      for (const s of Object.values(allDirty)) {
        const err = await s.save();
        if (err) {
          setBarError(err);
          return;
        }
      }
      router.refresh();
    } catch {
      setBarError("Couldn't reach the server — try again.");
    } finally {
      setBarPending(false);
    }
  }
  function discardAll() {
    for (const s of Object.values(allDirty)) s.discard();
    setBarError(null);
  }

  async function next() {
    // Unsaved edits ride the bar, not the Continue button — shake it instead of moving on.
    if (dirtyCount > 0) {
      setNudge((n) => n + 1);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      if (step === 6) {
        const r = await completeOnboarding();
        if (!r.ok) {
          setError(r.error);
          return;
        }
        router.refresh(); // the layout redirect now lands on the dashboard
        return;
      }
      const r = await advanceOnboarding({ skipChannels });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't reach the server — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function back() {
    if (step === 0 || busy) return;
    setError(null);
    await backToStep(step - 1);
    router.refresh();
  }

  // The rail: completed steps (before the current one) and visited-ahead steps with real saved
  // content are clickable jumps. A visited step with nothing saved dims like an unvisited one.
  const railLit = (i: number) => i === step || i < step || (i <= props.maxStep && props.stepHasContent[i]);
  const railClickable = (i: number) => i !== step && i <= props.maxStep && (i < step || props.stepHasContent[i]);
  async function jump(i: number) {
    if (!railClickable(i) || busy) return;
    if (dirtyCount > 0) {
      setNudge((n) => n + 1);
      return;
    }
    setError(null);
    await jumpToOnboardingStep(i);
    router.refresh();
  }

  // Step 1 only promises a pull when there is genuinely something new to pull — coming back with
  // nothing changed is a plain Continue (and the server skips the work to match).
  const willPull = step === 1 && anyConnected && props.channelsPullPending;
  const continueLabel = willPull ? "Pull my data & continue" : step === 6 ? "Finish setup — open consl" : "Continue";

  return (
    <CurrencyProvider symbol={props.currency.symbol} locale={props.currency.locale} code={props.currency.code}>
      <AccessProvider caps={props.caps}>
        <div className="min-h-dvh bg-header">
          {/* Top strip: the product mark, which company is being set up, and the only exits. */}
          <div className="mx-auto flex max-w-[1040px] items-center gap-3 px-4 pb-2 pt-5 sm:px-6">
            <AppLogo className="iso-invert" />
            <span className="text-[14px] font-semibold text-ink">consl</span>
            <span className="text-[12.5px] text-muted">· setting up</span>
            <div className="ml-auto flex items-center gap-2">
              <OrgSwitcher orgs={props.orgs} variant="header" />
              <SignOutButton>
                <button className="rounded-lg px-2.5 py-1.5 text-[12.5px] text-muted hover:bg-surface-2 hover:text-ink">Sign out</button>
              </SignOutButton>
            </div>
          </div>

          {/* Progress rail */}
          <div className="mx-auto max-w-[1040px] px-4 sm:px-6">
            {/* One line, always: the bar scrolls sideways before it ever wraps a step down. */}
            <div className="flex flex-nowrap items-center overflow-x-auto rounded-xl border border-border bg-surface px-3 py-2.5">
              {STEPS.map((title, i) => (
                <div key={title} className="flex shrink-0 items-center">
                  {i > 0 && <span className="mx-1.5 h-px w-3 shrink-0 bg-border sm:mx-2 sm:w-5" />}
                  <button
                    type="button"
                    onClick={() => jump(i)}
                    disabled={!railClickable(i)}
                    className={`flex items-center gap-1.5 whitespace-nowrap text-[12px] font-medium ${
                      i === step ? "text-ink" : i < step ? "text-accent" : railLit(i) ? "text-ink" : "text-muted"
                    } ${railClickable(i) ? "cursor-pointer hover:opacity-75" : "cursor-default"}`}
                  >
                    <span
                      className={`grid h-5 w-5 place-items-center rounded-full text-[10.5px] ${
                        i < step
                          ? "bg-accent-soft text-accent"
                          : i === step
                            ? "bg-ink text-bg"
                            : railLit(i)
                              ? "border border-ink/40 text-ink"
                              : "border border-border text-muted"
                      }`}
                    >
                      {i < step ? <Check size={11} /> : i}
                    </span>
                    <span className="hidden md:inline">{title}</span>
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Step body */}
          <main className="mx-auto max-w-[1040px] px-4 pb-28 pt-6 sm:px-6">
            <DirtyContext.Provider value={registerDirty}>
              {step === 0 && <StepCompany company={props.company} isOwner={props.isOwner} syncTz={props.syncTz} />}
              {step === 1 && (
                <StepChannels
                  providers={props.providers}
                  anyConnected={anyConnected}
                  skipChannels={skipChannels}
                  setSkipChannels={setSkipChannels}
                />
              )}
              {step === 2 && (
                <StepProducts
                  mapping={props.mapping}
                  products={props.products}
                  reorderDefaults={props.reorderDefaults}
                  cogValue={cogValue}
                  setCog={(id, v) => setCogDraft((d) => ({ ...d, [id]: v }))}
                />
              )}
              {step === 3 && (
                <StepFacilities
                  ownFacilities={ownFacilities}
                  channelCounts={props.channelCounts}
                  products={props.products}
                  finishedOpenings={props.finishedOpenings}
                />
              )}
              {step === 4 && (
                <StepMaterialsAndStock ownFacilities={ownFacilities} materials={props.materials} products={props.products} rawOpenings={props.rawOpenings} />
              )}
              {step === 5 && <StepProduction ownFacilities={ownFacilities} products={props.products} editing={props.lotEditing} />}
              {step === 6 && (
                <StepFinish
                  anyConnected={anyConnected}
                  channelCounts={props.channelCounts}
                  facilities={props.facilities}
                  products={props.products}
                  materials={props.materials}
                  finishedOpenings={props.finishedOpenings}
                  rawOpenings={props.rawOpenings}
                  inProduction={props.inProduction}
                />
              )}
            </DirtyContext.Provider>
          </main>

          {/* The one unsaved-changes bar — frosted like the app header, floating over the top.
              Continue shakes it (nudge) instead of moving while anything is registered. */}
          {dirtyCount > 0 && (
            <div className="fixed inset-x-0 top-4 z-50 flex justify-center px-4">
              <div
                key={nudge}
                className={`chrome-blur flex flex-wrap items-center gap-3 rounded-full border border-border px-4 py-2 shadow-lg ${nudge > 0 ? "bar-nudge" : ""}`}
              >
                <span className="text-[12.5px] font-medium text-ink-soft">
                  Unsaved changes · {Object.values(allDirty).map((s) => s.label).join(", ")}
                </span>
                {barError && <span className="max-w-[300px] truncate text-[12px] text-negative">{barError}</span>}
                <button
                  onClick={discardAll}
                  disabled={barPending}
                  className="rounded-full border btn-danger px-3.5 py-1.5 text-[12.5px] font-medium disabled:opacity-50"
                >
                  Discard
                </button>
                <button
                  onClick={saveAll}
                  disabled={barPending}
                  className="rounded-full bg-ink px-4 py-1.5 text-[12.5px] font-medium text-bg hover:opacity-90 disabled:opacity-50"
                >
                  {barPending ? "Saving…" : "Save changes"}
                </button>
              </div>
            </div>
          )}

          {showDialog && job && (
            <WorkingDialog
              job={job}
              onRetry={async () => {
                await retryOnboardingJob();
                setJob(await getOnboardingJob());
              }}
              onSkip={() => setDismissedJob(job.startedAt)}
            />
          )}

          {/* Footer nav — sticky so Continue is always in reach on long steps. */}
          <div className="fixed inset-x-0 bottom-0 border-t border-border bg-surface/95 backdrop-blur">
            <div className="mx-auto flex max-w-[1040px] flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
              {step > 0 && (
                <button
                  onClick={back}
                  disabled={busy}
                  className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-[13px] text-ink-soft hover:bg-surface-2 disabled:opacity-40"
                >
                  <ChevronLeft size={14} /> Back
                </button>
              )}
              <div className="min-w-0 flex-1">
                {error && (
                  <span className="flex items-start gap-1.5 text-[12.5px] text-negative">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {error}
                  </span>
                )}
                {!error && warning && <span className="text-[12.5px] text-warn">{warning}</span>}
                {!error && !warning && running && !showDialog && (
                  <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" aria-hidden />
                    {job?.phase || "Working in the background…"}
                  </span>
                )}
              </div>
              <button
                onClick={next}
                disabled={busy}
                className="rounded-lg bg-ink px-4 py-2 text-[13px] font-medium text-bg hover:opacity-90 disabled:opacity-40"
              >
                {busy ? (willPull ? "Pulling your data…" : "Working…") : continueLabel}
              </button>
            </div>
          </div>
        </div>
      </AccessProvider>
    </CurrencyProvider>
  );
}

/* ------------------------------ Progress dialog ------------------------------
 * Shown only on a step that can't proceed without the background job's result. Plain words for
 * what's happening, a rough time estimate, and — if the job failed — a way to retry or go on. */
const JOB_TITLE: Record<OnboardingJob["kind"], string> = { pull: "Pulling your channel data", stock: "Reading your stock" };
const JOB_MESSAGES: Record<OnboardingJob["kind"], string[]> = {
  pull: ["Reading your listings…", "Matching listings to your products…", "Reading your stock at each channel…", "Nearly there…"],
  stock: ["Reading your stock at each channel…", "Counting units at Amazon…", "Nearly there…"],
};

function WorkingDialog({ job, onRetry, onSkip }: { job: OnboardingJob; onRetry: () => Promise<void>; onSkip: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const [tick, setTick] = useState(0);
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
      setTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(id);
  }, []);
  const running = jobIsRunning(job);
  const elapsed = (now - new Date(job.startedAt).getTime()) / 1000;
  const remaining = job.expectedSeconds - elapsed;
  const eta =
    remaining > 8 ? `About ${Math.ceil(remaining / 5) * 5} seconds left` : remaining > 0 ? "Almost done…" : "Taking a little longer than usual — still working…";
  const messages = JOB_MESSAGES[job.kind];
  const message = job.phase || messages[Math.floor(tick / 3) % messages.length];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-4 chrome-blur">
      <div role="dialog" aria-modal="true" aria-live="polite" className="org-pop w-full max-w-[420px] rounded-[var(--radius-card)] border border-border bg-surface p-6 shadow-xl">
        {running ? (
          <>
            <div className="flex items-center gap-3">
              <span aria-hidden className="h-7 w-7 shrink-0 animate-spin rounded-full border-2 border-border border-t-accent" />
              <div className="min-w-0">
                <div className="text-[15px] font-semibold text-ink">{JOB_TITLE[job.kind]}</div>
                <div className="mt-0.5 text-[12.5px] text-muted">{eta}</div>
              </div>
            </div>
            <p className="mt-4 text-[13px] leading-relaxed text-ink-soft">{message}</p>
            <p className="mt-2 text-[12px] text-muted">This step needs that data, so it waits. Everything else you set up is saved.</p>
          </>
        ) : (
          <>
            <div className="flex items-start gap-3">
              <AlertTriangle size={20} className="mt-0.5 shrink-0 text-warn" />
              <div className="min-w-0">
                <div className="text-[15px] font-semibold text-ink">Couldn&apos;t finish reading your channels</div>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">{job.error ?? "The server lost track of this job — try again."}</p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={onSkip} className="rounded-lg border border-border px-3.5 py-2 text-[13px] text-ink-soft hover:bg-surface-2">
                Continue anyway
              </button>
              <button
                type="button"
                disabled={retrying}
                onClick={async () => {
                  setRetrying(true);
                  try {
                    await onRetry();
                  } finally {
                    setRetrying(false);
                  }
                }}
                className="rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-bg hover:opacity-90 disabled:opacity-50"
              >
                {retrying ? "Retrying…" : "Try again"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StepHeader({ title, body }: { title: string; body: string }) {
  return (
    <div className="mb-5">
      <h1 className="text-[20px] font-semibold tracking-tight text-ink">{title}</h1>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">{body}</p>
    </div>
  );
}

/** X → one confirm click → delete. Used on things created a step ago (facilities, materials). */
function DeleteX({ label, onDelete }: { label: string; onDelete: () => Promise<{ ok: boolean; error?: string }> }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setPending(true);
    setError(null);
    try {
      const r = await onDelete();
      if (!r.ok) {
        setError(r.error ?? "Couldn't delete.");
        setConfirm(false);
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't reach the server — try again.");
      setConfirm(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="flex items-center gap-1.5">
      {error && <span className="text-[11.5px] text-negative">{error}</span>}
      {confirm ? (
        <>
          <button
            onClick={run}
            disabled={pending}
            className="rounded-lg bg-negative px-2.5 py-1 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Deleting…" : `Delete ${label}`}
          </button>
          <button onClick={() => setConfirm(false)} disabled={pending} className="text-[12px] text-muted hover:text-ink-soft">
            Cancel
          </button>
        </>
      ) : (
        <button onClick={() => setConfirm(true)} className="p-1 text-muted hover:text-negative" aria-label={`Delete ${label}`}>
          <X size={15} />
        </button>
      )}
    </span>
  );
}

/* ---------------------------------- Step 0: company ---------------------------------- */

function StepCompany({ company, isOwner, syncTz }: { company: CompanyForEdit; isOwner: boolean; syncTz: string }) {
  // Both editors save through the wizard's floating bar, like every other step.
  type BarState = { save: () => Promise<string | null>; discard: () => void } | null;
  const [companyState, setCompanyState] = useState<BarState>(null);
  const [tzState, setTzState] = useState<BarState>(null);
  useDirtySection("company", !!companyState, {
    label: "company details",
    save: () => companyState?.save() ?? Promise.resolve(null),
    discard: () => companyState?.discard(),
  });
  useDirtySection("timezone", !!tzState, {
    label: "time zone",
    save: () => tzState?.save() ?? Promise.resolve(null),
    discard: () => tzState?.discard(),
  });
  return (
    <div className="space-y-4">
      <StepHeader
        title="Set up your company"
        body="These details appear across the app and on the documents consl generates for you. Fill in at least your company name, address and email. The time zone decides when your business day starts and ends."
      />
      <CompanyEditor company={company} isOwner={isOwner} hideSaveBar onDirtyState={setCompanyState} />
      <TimezoneSettings initialTz={syncTz} lastSyncAt={null} hideSaveBar onDirtyState={setTzState} />
    </div>
  );
}

/* ---------------------------------- Step 1: channels ---------------------------------- */

function StepChannels({
  providers,
  anyConnected,
  skipChannels,
  setSkipChannels,
}: {
  providers: Array<{ key: string; label: string; blurb: string; logo: string; connected: boolean; canConnect: boolean }>;
  anyConnected: boolean;
  skipChannels: boolean;
  setSkipChannels: (v: boolean) => void;
}) {
  return (
    <div className="space-y-4">
      <StepHeader
        title="Connect your sales channels"
        body="Connect EVERY channel where you sell or hold stock — consl reads what each one is holding right now and makes that your starting inventory. A channel you skip is stock consl can't see, so your numbers would start wrong. Connecting also starts importing your full order history in the background — up to about two years for Amazon — so keep going; it finishes on its own."
      />
      {providers.map((p) => (
        <div key={p.key} className={`${panelCls} flex flex-wrap items-center gap-4`}>
          {/* The platform's own mark on a white tile — same treatment as everywhere else. */}
          <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white p-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.logo} alt="" className="max-h-full max-w-full object-contain" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[14.5px] font-semibold text-ink">{p.label}</span>
              {p.connected ? (
                <span className="pill-green inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[11px] font-medium leading-none">
                  <Check size={11} /> Connected
                </span>
              ) : (
                <span className="pill-neutral inline-flex items-center rounded-full px-2 py-[3px] text-[11px] font-medium leading-none">
                  {p.canConnect ? "Not connected" : "Coming soon"}
                </span>
              )}
            </div>
            <div className="mt-0.5 text-[12.5px] text-muted">{p.blurb}</div>
          </div>
          <IntegrationControls provider={p.key as "amazon" | "shopify" | "tiktok"} connected={p.connected} canConnect={p.canConnect} />
        </div>
      ))}
      {!anyConnected && (
        <label className="flex items-center gap-2 text-[13px] text-ink-soft">
          <input type="checkbox" checked={skipChannels} onChange={(e) => setSkipChannels(e.target.checked)} className="accent-accent" />
          I don&apos;t sell on any of these platforms yet
        </label>
      )}
      {anyConnected && (
        <p className="text-[12.5px] text-muted">
          Connected everything? Continue — consl pulls each channel&apos;s catalog and current stock next (this can take a few seconds).
        </p>
      )}
    </div>
  );
}

/* ------------------------------ Step 2: products + costs ------------------------------ */

function StepProducts({
  mapping,
  products,
  reorderDefaults,
  cogValue,
  setCog,
}: {
  mapping: WizardMapping;
  products: WizardProduct[];
  reorderDefaults: ReorderDefaults;
  cogValue: (p: WizardProduct) => string;
  setCog: (id: string, v: string) => void;
}) {
  const { money } = useMoney();
  const router = useRouter();
  const registerDirty = useContext(DirtyContext);
  // One row at a time flips into rename mode (abbreviation + title) via the hover pencil.
  const [edit, setEdit] = useState<{ id: string; code: string; name: string } | null>(null);
  const [editPending, setEditPending] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);

  async function saveEdit() {
    if (!edit || editPending) return;
    setEditPending(true);
    setEditErr(null);
    try {
      const r = await updateProduct({ id: edit.id, code: edit.code, name: edit.name });
      if (!r.ok) {
        setEditErr(r.error ?? "Couldn't save.");
        return;
      }
      setEdit(null);
      router.refresh();
    } catch {
      setEditErr("Couldn't reach the server — try again.");
    } finally {
      setEditPending(false);
    }
  }
  return (
    <div className="space-y-6">
      <StepHeader
        title="Your products"
        body={
          mapping
            ? "Every listing your channels sell needs a decision: map it to a product, import it as a new one, or ignore it (bundles, samples, discontinued items). Then tell consl what one unit of each product costs you today — that prices your starting stock — and set the rules it reorders by."
            : "No channels connected — create your products (SKUs) by hand, then tell consl what one unit of each costs you today. That prices your starting stock. Last, set the rules it reorders by."
        }
      />

      {mapping && (
        <section className={panelCls}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[14px] font-semibold text-ink">Map your channel listings</h2>
            <div className="flex flex-wrap items-center gap-1.5">
              {Object.entries(mapping.pendingByChannel).map(([ch, n]) => (
                <span
                  key={ch}
                  className={`${n > 0 ? "pill-neutral" : "pill-green"} inline-flex items-center rounded-full border px-2 py-[3px] text-[11px] font-medium`}
                >
                  {ch === "AMAZON" ? "Amazon" : ch === "SHOPIFY" ? "Shopify" : "TikTok"}: {n > 0 ? `${n} unmapped` : "all mapped"}
                </span>
              ))}
            </div>
          </div>
          <ChannelMappingClient
            channel={mapping.channel}
            tabs={mapping.tabs}
            rows={mapping.rows}
            products={mapping.pickerProducts}
            justConnected={false}
            hrefBase="/onboarding"
            hideSave
            onStagesChange={(s) => registerDirty?.("mapping", s ? { label: "channel mapping", ...s } : null)}
          />
        </section>
      )}

      <section className={panelCls}>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[14px] font-semibold text-ink">Starting cost per unit</h2>
          <NewProductButton />
        </div>
        <p className="mb-4 text-[12.5px] text-muted">
          For each product: what does ONE unit cost you today, all-in (make or buy)? This average prices only the stock you already
          hold — the day you produce through consl, every new unit gets its real, FIFO-calculated cost instead.
        </p>
        {products.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface-2 px-4 py-6 text-center text-[13px] text-muted">
            No products yet — import them from a channel above, or create one by hand.
          </div>
        ) : (
          <div className="divide-y divide-line overflow-hidden rounded-lg border border-border">
            {products.map((p) => (
              <div key={p.id} className="group flex items-center gap-3 bg-surface px-3 py-2">
                <SkuAvatar code={p.code} size={30} imageUrl={p.imageUrl} />
                {edit?.id === p.id ? (
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                    <input
                      value={edit.code}
                      onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase() })}
                      onKeyDown={(e) => (e.key === "Enter" ? saveEdit() : e.key === "Escape" ? setEdit(null) : undefined)}
                      aria-label="Abbreviation"
                      className={`${inputCls} max-w-24`}
                      autoFocus
                    />
                    <input
                      value={edit.name}
                      onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                      onKeyDown={(e) => (e.key === "Enter" ? saveEdit() : e.key === "Escape" ? setEdit(null) : undefined)}
                      aria-label="Product title"
                      className={`${inputCls} min-w-0 flex-1`}
                      maxLength={NAME_MAX}
                    />
                    <button
                      onClick={saveEdit}
                      disabled={editPending}
                      className="rounded-lg bg-ink px-2.5 py-1.5 text-[12px] font-medium text-bg hover:opacity-90 disabled:opacity-50"
                    >
                      {editPending ? "Saving…" : "Save"}
                    </button>
                    <button
                      onClick={() => {
                        setEdit(null);
                        setEditErr(null);
                      }}
                      className="rounded-lg border border-border px-2.5 py-1.5 text-[12px] font-medium text-ink-soft hover:text-ink"
                    >
                      Cancel
                    </button>
                    {editErr && <span className="w-full text-[11.5px] text-negative">{editErr}</span>}
                  </div>
                ) : (
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="shrink-0 text-[13px] font-medium text-ink">{p.code}</span>
                    <span className="min-w-0 truncate text-[12.5px] text-muted">{p.name}</span>
                    <button
                      onClick={() => {
                        setEdit({ id: p.id, code: p.code, name: p.name });
                        setEditErr(null);
                      }}
                      title="Rename — abbreviation or title"
                      aria-label={`Rename ${p.code}`}
                      className="shrink-0 rounded p-1 text-muted opacity-0 transition-opacity hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <Pencil size={13} />
                    </button>
                  </div>
                )}
                <div className="flex shrink-0 items-center gap-1.5">
                  {/* inputCls carries w-full — cap with max-w or the field swallows the row */}
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={cogValue(p)}
                    onChange={(e) => setCog(p.id, e.target.value)}
                    placeholder="0.00"
                    className={`${inputCls} tabular max-w-28 text-right`}
                  />
                  <span className="w-14 text-[11.5px] text-muted">per unit</span>
                </div>
              </div>
            ))}
          </div>
        )}
        {products.length > 0 && (
          <p className="mt-2 text-[11.5px] text-muted">
            Example: {products[0].code} at {money(4.2)} means every {products[0].code} you hold today is worth {money(4.2)} at cost.
          </p>
        )}
      </section>

      {/* Remounts on every saved value set, so a fresh draft always starts from what the server holds. */}
      <ReorderDefaultsSection key={JSON.stringify(reorderDefaults)} defaults={reorderDefaults} />
    </div>
  );
}

/* ----------------------------- Step 2 (cont.): reorder rules ----------------------------- */

const REORDER_FIELDS: { key: keyof ReorderDefaults; label: string; help: { title: string; body: string }; step: string }[] = [
  { key: "minMonths", label: "Floor (months of cover)", help: FLOOR_HELP, step: "0.5" },
  { key: "leadMonths", label: "Production lead time (months)", help: LEAD_HELP, step: "0.5" },
  { key: "shipDays", label: "Shipping time (days)", help: SHIP_HELP, step: "1" },
  { key: "shipBufferX", label: "Shipping buffer (×)", help: BUFFER_HELP, step: "0.5" },
  { key: "reorderTo", label: "Order size (months of sales)", help: REORDER_TO_HELP, step: "0.5" },
  { key: "batchSize", label: "Batch size (units)", help: BATCH_HELP, step: "1" },
];

const reorderDraftOf = (d: ReorderDefaults) => Object.fromEntries(REORDER_FIELDS.map((f) => [f.key, String(d[f.key])])) as Record<keyof ReorderDefaults, string>;

/** The company-wide reorder rules — the same six settings the Reorder page's gear edits, asked
 *  once here so the first restock alerts already speak the company's numbers. Saved through the
 *  wizard's floating bar like every other section; blank falls back to the current value. */
function ReorderDefaultsSection({ defaults }: { defaults: ReorderDefaults }) {
  const baseline = reorderDraftOf(defaults);
  const [draft, setDraft] = useState(baseline);
  const dirty = REORDER_FIELDS.some((f) => draft[f.key] !== baseline[f.key]);
  const parsed = (): ReorderDefaults => {
    const num = (k: keyof ReorderDefaults) => {
      const v = draft[k].trim();
      const n = v === "" ? defaults[k] : parseFloat(v.replace(",", "."));
      return Number.isFinite(n) ? n : defaults[k];
    };
    return { minMonths: num("minMonths"), leadMonths: num("leadMonths"), shipDays: num("shipDays"), shipBufferX: num("shipBufferX"), reorderTo: num("reorderTo"), batchSize: num("batchSize") };
  };
  useDirtySection("reorder", dirty, {
    label: "reorder rules",
    save: async () => {
      try {
        const r = await updateGlobalDefaults(parsed());
        return r.ok ? null : (r.error ?? "Couldn't save the reorder rules.");
      } catch {
        return "Couldn't reach the server — try again.";
      }
    },
    discard: () => setDraft(baseline),
  });
  return (
    <section className={panelCls}>
      <h2 className="text-[14px] font-semibold text-ink">How consl reorders</h2>
      <p className="mt-1 max-w-[80ch] text-[12.5px] text-muted">
        The rules behind every restock alert: how much cover to keep, how long a production run and a shipment take, and how big an
        order should be. Company-wide defaults — any product can get its own numbers later from the Reorder page. Hover a label for
        what it means.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {REORDER_FIELDS.map((f) => (
          <label key={f.key} className="text-[11.5px] text-muted">
            <div className="mb-1 flex items-center gap-1">
              {f.label}
              <HoverHint {...f.help} size={11} />
            </div>
            <input
              type="number"
              min="0"
              step={f.step}
              value={draft[f.key]}
              onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
              className={`${inputCls} tabular`}
            />
          </label>
        ))}
      </div>
    </section>
  );
}

/* --------------------------- Step 3: facilities + finished stock --------------------------- */

function StepFacilities({
  ownFacilities,
  channelCounts,
  products,
  finishedOpenings,
}: {
  ownFacilities: WizardFacility[];
  channelCounts: ChannelCount[];
  products: WizardProduct[];
  finishedOpenings: Record<string, Record<string, number>>;
}) {
  const { money } = useMoney();
  const imageByCode = new Map(products.map((p) => [p.code, p.imageUrl]));
  return (
    <div className="space-y-6">
      <StepHeader
        title="Your facilities and their stock"
        body="Create every place you hold stock — raw materials or finished products — and everywhere you fulfill from: co-packers, your own warehouses, 3PLs. Then enter how many finished units of each product sit at each one today. Your connected channels are already here; their stock is counted automatically."
      />

      <NewFacilityInline />

      {ownFacilities.length > 0 && (
        <section className="space-y-4">
          {ownFacilities.map((f) => (
            <FinishedBalanceCard key={f.id} facility={f} products={products} initial={finishedOpenings[f.id] ?? {}} />
          ))}
        </section>
      )}

      {channelCounts.length > 0 && (
        <section className={panelCls}>
          <h2 className="mb-1 flex items-center gap-1.5 text-[14px] font-semibold text-ink">
            <Lock size={13} className="text-muted" /> Sales channels — counted automatically
          </h2>
          <p className="mb-3 text-[12.5px] text-muted">
            These are what your connected channels report holding right now. When you finish setup, consl records them as your
            starting balance at your starting cost — nothing to type here.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {channelCounts.map((c) => {
              const units = c.skus.reduce((t, s) => t + s.units, 0);
              const value = c.skus.reduce((t, s) => t + (s.value ?? 0), 0);
              const unpriced = c.skus.some((s) => s.value == null);
              const cols = "grid grid-cols-[minmax(0,1fr)_5.5rem_6.5rem] items-center gap-x-3";
              return (
                <div key={c.channel} className="flex flex-col rounded-xl border border-border bg-surface p-4">
                  <div className="flex items-center gap-2.5">
                    {ROOT_LOGO[c.channel] && (
                      <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-surface-2">
                        <Image src={ROOT_LOGO[c.channel]} alt="" width={20} height={20} />
                      </span>
                    )}
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-semibold text-ink">{c.label}</div>
                      <div className="text-[11.5px] text-muted">
                        {c.skus.length === 0 ? "Nothing in stock right now" : `${c.skus.length} product${c.skus.length === 1 ? "" : "s"} in stock`}
                      </div>
                    </div>
                  </div>
                  {c.skus.length > 0 && (
                    <>
                      <div className={`${cols} mt-4 border-b border-line pb-1.5 text-[10.5px] font-medium uppercase tracking-wider text-muted`}>
                        <span>Product</span>
                        <span className="text-right">Units</span>
                        <span className="text-right">Value</span>
                      </div>
                      <div className="divide-y divide-line/70">
                        {c.skus.map((s) => (
                          <div key={s.code} className={`${cols} py-1.5 text-[12.5px]`}>
                            <span className="flex min-w-0 items-center gap-2">
                              <SkuAvatar code={s.code} size={20} imageUrl={imageByCode.get(s.code) ?? null} />
                              <span className="truncate font-medium text-ink">{s.code}</span>
                            </span>
                            <span className="tabular text-right text-ink">{s.units.toLocaleString()}</span>
                            <span
                              className="tabular text-right text-ink-soft"
                              title={s.value == null ? "Enter this product's starting cost on the previous step" : undefined}
                            >
                              {s.value == null ? "—" : money(s.value, 0)}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className={`${cols} mt-3 rounded-lg bg-surface-2 px-2.5 py-2 text-[12.5px]`}>
                        <span className="font-semibold text-ink">Total</span>
                        <span className="tabular text-right font-semibold text-ink">{units.toLocaleString()}</span>
                        <span className="tabular text-right font-semibold text-ink">
                          {money(value, 0)}
                          {unpriced ? "*" : ""}
                        </span>
                      </div>
                      {unpriced && (
                        <div className="mt-1.5 text-[11px] text-muted">* products without a starting cost yet aren&apos;t in the value.</div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

/** Inline facility creation — the wizard can't navigate away, so no detail-page redirect. */
function NewFacilityInline() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<string>("warehouse");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setPending(true);
    setError(null);
    try {
      const r = await createFacility({ code, name, type });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setCode("");
      setName("");
      setOpen(false);
      router.refresh();
    } catch {
      setError("Couldn't reach the server — try again.");
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-2 text-[12.5px] font-medium text-bg hover:opacity-90"
      >
        <Plus size={15} /> Add a facility
      </button>
    );
  }
  return (
    <div className={panelCls}>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[13px] font-semibold text-ink">New facility</span>
        <button onClick={() => setOpen(false)} className="text-muted hover:text-ink">
          <X size={16} />
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Short code" hint="e.g. WH1">
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className={inputCls} placeholder="WH1" />
        </Field>
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="e.g. East Coast 3PL" />
        </Field>
        <Field label="Type">
          <SelectMenu
            value={type}
            onChange={setType}
            ariaLabel="Facility type"
            options={FACILITY_TYPES.map((t) => ({ value: t.value, label: t.label, hint: t.hint }))}
          />
        </Field>
      </div>
      {error && <div className="mt-2 text-[12px] text-negative">{error}</div>}
      <div className="mt-3 flex justify-end">
        <button
          onClick={save}
          disabled={pending || !code.trim() || !name.trim()}
          className="rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-bg hover:opacity-90 disabled:opacity-40"
        >
          {pending ? "Creating…" : "Create facility"}
        </button>
      </div>
    </div>
  );
}

/** Per-facility grid: how many finished units of each SKU sit here today. Saves as OPENING layers. */
function FinishedBalanceCard({
  facility,
  products,
  initial,
}: {
  facility: WizardFacility;
  products: WizardProduct[];
  initial: Record<string, number>;
}) {
  const { money } = useMoney();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const value = (p: WizardProduct) => draft[p.id] ?? (initial[p.id] != null ? String(initial[p.id]) : "");
  const dirty = products.some((p) => value(p) !== (initial[p.id] != null ? String(initial[p.id]) : ""));

  // Saves ride the wizard's floating bar — this card only reports its dirty state.
  useDirtySection(`fin-${facility.id}`, dirty, {
    label: facility.code,
    save: async () => {
      try {
        const rows = products.map((p) => ({ productId: p.id, units: Number(value(p)) || 0 }));
        const r = await saveFinishedOpenings(facility.id, rows);
        if (!r.ok) return r.error;
        setDraft({});
        return null;
      } catch {
        return "Couldn't reach the server — try again.";
      }
    },
    discard: () => setDraft({}),
  });

  return (
    <div className={panelCls}>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h3 className="text-[13.5px] font-semibold text-ink">
          {facility.code} <span className="font-normal text-muted">· {facility.name}</span>
        </h3>
        <span className="ml-auto">
          <DeleteX label={facility.code} onDelete={() => deleteOnboardingFacility(facility.id)} />
        </span>
      </div>
      <p className="mb-3 text-[12px] text-muted">Finished units sitting here today (leave 0 if none).</p>
      {products.length === 0 ? (
        <div className="text-[12.5px] text-muted">Create your products first (previous step).</div>
      ) : (
        <div className="divide-y divide-line overflow-hidden rounded-lg border border-border">
          {products.map((p) => (
            <div key={p.id} className="flex items-center gap-3 bg-surface px-3 py-2">
              <SkuAvatar code={p.code} size={26} imageUrl={p.imageUrl} />
              <div className="min-w-0 flex-1">
                <span className="text-[12.5px] font-medium text-ink">{p.code}</span>
                {p.openingUnitCost != null && <span className="ml-2 text-[11.5px] text-muted">at {money(p.openingUnitCost)}/unit</span>}
              </div>
              <input
                type="number"
                min="0"
                step="1"
                value={value(p)}
                onChange={(e) => setDraft((d) => ({ ...d, [p.id]: e.target.value }))}
                placeholder="0"
                className={`${inputCls} tabular max-w-28 shrink-0 text-right`}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------- Step 4: materials ---------------------------------- */

function StepMaterialsAndStock({
  ownFacilities,
  materials,
  products,
  rawOpenings,
}: {
  ownFacilities: WizardFacility[];
  materials: WizardMaterial[];
  products: WizardProduct[];
  rawOpenings: Record<string, RawLine[]>;
}) {
  return (
    <div className="space-y-4">
      <StepHeader
        title="Your raw materials and their stock"
        body="Create everything your finished products consume when they're made — ingredients, bags, pouches, boxes, labels — then enter how much of each sits at every facility today and what you paid per unit. They become your oldest stock, used up first by production. If you don't make anything (you only buy finished goods), just continue."
      />
      <div className="flex items-start gap-3 rounded-[var(--radius-card)] border tint-amber px-4 py-3">
        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warn" />
        <div className="text-[13px] leading-relaxed text-ink">
          <span className="font-semibold">Count the material that is already inside a production run, too.</span> On the next step you&apos;ll
          create the lots that are in production right now, and each one consumes its materials from what you enter here. Leave that
          material out and those lots will come up short.
        </div>
      </div>
      <div className={`${panelCls}`}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[14px] font-semibold text-ink">Raw materials</h2>
          <NewMaterialButton />
        </div>
        {materials.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface-2 px-4 py-6 text-center text-[13px] text-muted">
            Nothing yet — add your first raw material, or continue if you don&apos;t hold any.
          </div>
        ) : (
          <div className="divide-y divide-line overflow-hidden rounded-lg border border-border">
            {materials.map((m) => (
              <div key={m.id} className="flex items-center gap-3 bg-surface px-3 py-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-surface-2 text-muted">
                  <Package size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <span className="text-[13px] font-medium text-ink">{m.name}</span>
                  <span className="ml-2 text-[11.5px] text-muted">counted in {m.unitLabel}s</span>
                </div>
                {m.skuSpecific && (
                  <span className="pill-neutral inline-flex items-center rounded-full border px-2 py-[3px] text-[10.5px] font-medium">
                    per-product stock
                  </span>
                )}
                <DeleteX label={m.name} onDelete={() => deleteOnboardingMaterial(m.id)} />
              </div>
            ))}
          </div>
        )}
      </div>

      {materials.length > 0 && (
        <>
          <h2 className="pt-2 text-[15px] font-semibold text-ink">Starting balances</h2>
          {ownFacilities.length === 0 ? (
            <div className={`${panelCls} text-[13px] text-muted`}>No facilities to hold raw materials — go back to add one, or continue.</div>
          ) : (
            ownFacilities.map((f) => (
              <RawBalanceCard key={f.id} facility={f} materials={materials} products={products} initial={rawOpenings[f.id] ?? []} />
            ))
          )}
        </>
      )}
    </div>
  );
}

function RawBalanceCard({
  facility,
  materials,
  products,
  initial,
}: {
  facility: WizardFacility;
  materials: WizardMaterial[];
  products: WizardProduct[];
  initial: RawLine[];
}) {
  type Line = { materialTypeId: string; productId: string; quantity: string; unitCost: string };
  const fromInitial = () =>
    initial.map((l) => ({
      materialTypeId: l.materialTypeId,
      productId: l.productId ?? "",
      quantity: String(l.quantity),
      unitCost: String(l.unitCost),
    }));
  const [lines, setLines] = useState<Line[]>(fromInitial);
  const matById = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);

  function addLine() {
    setLines((ls) => [...ls, { materialTypeId: materials[0]?.id ?? "", productId: "", quantity: "", unitCost: "" }]);
  }
  function update(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }
  function remove(i: number) {
    setLines((ls) => ls.filter((_, j) => j !== i));
  }

  // Dirty compares what would actually be SAVED — empty/zero lines don't count, so an untouched
  // blank line never blocks Continue.
  const normalize = (rows: { materialTypeId: string; productId: string | null; quantity: number | string; unitCost: number | string }[]) =>
    JSON.stringify(
      rows
        .map((r) => ({ m: r.materialTypeId, p: r.productId || "", q: Number(r.quantity) || 0, c: Number(r.unitCost) || 0 }))
        .filter((r) => r.q > 0)
        .sort((a, b) => `${a.m}|${a.p}`.localeCompare(`${b.m}|${b.p}`)),
    );
  const dirty = normalize(lines) !== normalize(initial);

  useDirtySection(`raw-${facility.id}`, dirty, {
    label: facility.code,
    save: async () => {
      try {
        const rows = lines.map((l) => ({
          materialTypeId: l.materialTypeId,
          productId: l.productId || null,
          quantity: Number(l.quantity) || 0,
          unitCost: Number(l.unitCost) || 0,
        }));
        const r = await saveRawOpenings(facility.id, rows);
        return r.ok ? null : r.error;
      } catch {
        return "Couldn't reach the server — try again.";
      }
    },
    discard: () => setLines(fromInitial()),
  });

  return (
    <div className={panelCls}>
      <h3 className="text-[13.5px] font-semibold text-ink">
        {facility.code} <span className="font-normal text-muted">· {facility.name}</span>
      </h3>
      <p className="mb-3 mt-1 text-[12px] text-muted">Each line: a material here today, how much of it, and what you paid per {materials[0]?.unitLabel ?? "unit"}.</p>
      <div className="space-y-2">
        {lines.map((l, i) => {
          const mat = matById.get(l.materialTypeId);
          return (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-2 px-2.5 py-2">
              <SelectMenu
                value={l.materialTypeId}
                onChange={(v) => update(i, { materialTypeId: v, productId: "" })}
                ariaLabel="Material"
                className="min-w-[160px] flex-1 basis-40"
                options={materials.map((m) => ({ value: m.id, label: m.name }))}
              />
              {mat?.skuSpecific && (
                <SelectMenu
                  value={l.productId}
                  onChange={(v) => update(i, { productId: v })}
                  ariaLabel="For which product"
                  placeholder="For which product?"
                  className="w-[170px] shrink-0"
                  options={products.map((p) => ({
                    value: p.id,
                    label: p.code,
                    icon: <SkuAvatar code={p.code} size={20} imageUrl={p.imageUrl} />,
                  }))}
                />
              )}
              <input
                type="number"
                min="0"
                value={l.quantity}
                onChange={(e) => update(i, { quantity: e.target.value })}
                placeholder="Qty"
                className={`${inputCls} tabular max-w-24 shrink-0 text-right`}
              />
              <input
                type="number"
                min="0"
                step="0.0001"
                value={l.unitCost}
                onChange={(e) => update(i, { unitCost: e.target.value })}
                placeholder="Cost/unit"
                className={`${inputCls} tabular max-w-28 shrink-0 text-right`}
              />
              <button onClick={() => remove(i)} className="p-1 text-muted hover:text-negative" aria-label="Remove line">
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button onClick={addLine} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-[12.5px] text-ink-soft hover:bg-surface-2">
          <Plus size={13} /> Add material
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------- Step 6: finish ---------------------------------- */

/** One slice of the starting inventory: a place (channel or facility) and what it holds. */
type OpeningSlice = { key: string; label: string; sub: string; value: number; color: string };

const CHANNEL_COLOR: Record<string, string> = { AMAZON: SEG.available, SHOPIFY: SEG.shopify, TIKTOK: SEG.tiktok };

function StepFinish({
  anyConnected,
  channelCounts,
  facilities,
  products,
  materials,
  finishedOpenings,
  rawOpenings,
  inProduction,
}: {
  anyConnected: boolean;
  channelCounts: ChannelCount[];
  facilities: WizardFacility[];
  products: WizardProduct[];
  materials: WizardMaterial[];
  finishedOpenings: Record<string, Record<string, number>>;
  rawOpenings: Record<string, RawLine[]>;
  inProduction: InProduction;
}) {
  const { money } = useMoney();
  const totalChannelUnits = channelCounts.reduce((s, c) => s + c.skus.reduce((x, k) => x + k.units, 0), 0);

  // What Finish records, place by place, at the costs entered — the same arithmetic the server
  // runs, shown up front so nothing lands in the books unseen.
  const costById = new Map(products.map((p) => [p.id, p.openingUnitCost ?? 0]));
  const facilityName = new Map(facilities.map((f) => [f.id, f.name]));
  const materialName = new Map(materials.map((m) => [m.id, m.name]));
  const slices: OpeningSlice[] = [];
  for (const c of channelCounts) {
    const units = c.skus.reduce((t, k) => t + k.units, 0);
    if (units === 0) continue;
    slices.push({
      key: `channel:${c.channel}`,
      label: c.label,
      sub: `${units.toLocaleString()} units · ${c.skus.length} product${c.skus.length === 1 ? "" : "s"}`,
      value: c.skus.reduce((t, k) => t + (k.value ?? 0), 0),
      color: CHANNEL_COLOR[c.channel] ?? SEG.locations,
    });
  }
  for (const [facilityId, byProduct] of Object.entries(finishedOpenings)) {
    const entries = Object.entries(byProduct).filter(([, q]) => q > 0);
    const units = entries.reduce((t, [, q]) => t + q, 0);
    if (units === 0) continue;
    slices.push({
      key: `finished:${facilityId}`,
      label: facilityName.get(facilityId) ?? "Your location",
      sub: `${units.toLocaleString()} finished units · ${entries.length} product${entries.length === 1 ? "" : "s"}`,
      value: entries.reduce((t, [productId, q]) => t + q * (costById.get(productId) ?? 0), 0),
      color: SEG.locations,
    });
  }
  for (const [facilityId, lines] of Object.entries(rawOpenings)) {
    const live = lines.filter((l) => l.quantity > 0);
    if (live.length === 0) continue;
    const names = [...new Set(live.map((l) => materialName.get(l.materialTypeId) ?? "material"))];
    const counted = live.reduce((t, l) => t + l.quantity * l.unitCost, 0);
    // Whatever the lots in production already drew is theirs now — it shows under "In production".
    const drawn = Math.min(counted, inProduction.rawConsumedByFacility[facilityId] ?? 0);
    slices.push({
      key: `raw:${facilityId}`,
      label: `Raw materials at ${facilityName.get(facilityId) ?? "your location"}`,
      sub:
        (names.length <= 3 ? names.join(", ") : `${names.slice(0, 2).join(", ")} +${names.length - 2} more`) +
        (drawn > 0 ? ` · after ${money(drawn, 0)} drawn by production` : ""),
      value: counted - drawn,
      color: SEG.raw,
    });
  }
  if (inProduction.lots > 0) {
    slices.push({
      key: "production",
      label: "In production",
      sub: `${inProduction.lots} lot${inProduction.lots === 1 ? "" : "s"} · ${inProduction.units.toLocaleString()} units on the way · materials and costs so far`,
      value: inProduction.value,
      color: SEG.production,
    });
  }
  const totalValue = slices.reduce((t, x) => t + x.value, 0);
  const shown = [...slices].sort((a, b) => b.value - a.value);

  return (
    <div className="space-y-4">
      <StepHeader
        title="Almost done"
        body="One last thing to know, then consl opens with your starting balances in place."
      />
      <div className={panelCls}>
        <div className="text-[12px] font-medium uppercase tracking-wide text-muted">Starting inventory you&apos;re recording</div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-[30px] font-semibold tracking-tight text-ink">{money(totalValue, 0)}</span>
          <span className="text-[12.5px] text-muted">
            {shown.length === 0
              ? "nothing counted yet — you can still finish and add stock later"
              : `across ${shown.length} place${shown.length === 1 ? "" : "s"}, at the costs you entered`}
          </span>
        </div>
        {shown.length > 0 && (
          <>
            <div className="mt-4 flex h-2.5 w-full overflow-hidden rounded-full bg-surface-2" aria-hidden>
              {shown.map((x) => (
                <span
                  key={x.key}
                  className="h-full"
                  style={{ width: `${totalValue > 0 ? Math.max(1.5, (x.value / totalValue) * 100) : 100 / shown.length}%`, background: x.color }}
                />
              ))}
            </div>
            <div className="mt-3 divide-y divide-line/70">
              {shown.map((x) => (
                <div key={x.key} className="flex items-center gap-3 py-2 text-[13px]">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: x.color }} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-ink">{x.label}</div>
                    <div className="truncate text-[11.5px] text-muted">{x.sub}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="tabular font-semibold text-ink">{money(x.value, 0)}</div>
                    <div className="tabular text-[11px] text-muted">{totalValue > 0 ? `${Math.round((x.value / totalValue) * 100)}%` : ""}</div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      <div className={panelCls}>
        <h2 className="mb-2 text-[14px] font-semibold text-ink">
          {inProduction.lots > 0 ? "Runs in production" : "Nothing in production?"}
        </h2>
        <p className="text-[13px] leading-relaxed text-ink-soft">
          {inProduction.lots > 0
            ? `The ${inProduction.lots} lot${inProduction.lots === 1 ? "" : "s"} you created open as live production runs: their materials are already consumed from your starting stock, the costs you attached count towards their COG, and you finish them from Production Lots when the units are ready.`
            : "If a co-packer is mid-run on a batch right now, go back one step and add it — it will consume its materials from the stock you counted and carry the payments you attach. You can also add it later from Production Lots."}
        </p>
      </div>
      {anyConnected && (
        <div className={panelCls}>
          <h2 className="mb-2 text-[14px] font-semibold text-ink">What happens when you finish</h2>
          <p className="text-[13px] leading-relaxed text-ink-soft">
            The {totalChannelUnits.toLocaleString()} units your channels report holding are recorded as your starting balance at the
            costs you entered, alongside the facility balances you saved. From here on, everything you buy, make, move and sell is
            tracked live — and your starting stock is simply the oldest layer, sold through first.
          </p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ Step 5: production in progress ------------------------------
 * Lots are created the way the app creates them and then edited with the app's own lot editor
 * (SKUs, units, a recipe per SKU) and costed with its own transaction forms — nothing here is a
 * wizard-only imitation, so what's set up is exactly what Production Lots shows afterwards. */

function StepProduction({ ownFacilities, products, editing }: { ownFacilities: WizardFacility[]; products: WizardProduct[]; editing: LotEditing }) {
  const [adding, setAdding] = useState(editing.lots.length === 0);
  // One lot open at a time — the list stays scannable however many runs there are. A lot just
  // created opens itself; otherwise everything starts folded to its summary line.
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <StepHeader
        title="Production in progress"
        body="Anything a co-packer is making for you right now: create it as a lot with the products and units on order. Each lot consumes its materials from the stock you just counted, and the payments you attach to it count towards its cost — exactly as in the app from here on. Nothing in production? Just continue."
      />
      {editing.lots.length > 0 && (
        <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
          {editing.lots.map((lot, i) => (
            <WizardLotPanel
              key={lot.id}
              lot={lot}
              ownFacilities={ownFacilities}
              products={products}
              editing={editing}
              open={openId === lot.id}
              onToggle={() => setOpenId((cur) => (cur === lot.id ? null : lot.id))}
              last={i === editing.lots.length - 1}
            />
          ))}
        </div>
      )}
      {adding ? (
        <NewLotPanel
          ownFacilities={ownFacilities}
          products={products}
          nextLotNr={editing.nextLotNr}
          onDone={(createdId) => {
            setAdding(false);
            if (createdId) setOpenId(createdId);
          }}
          cancellable={editing.lots.length > 0}
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3.5 py-2 text-[13px] font-medium text-ink-soft hover:bg-surface-2"
        >
          <Plus size={15} /> Add another lot
        </button>
      )}
    </div>
  );
}

function NewLotPanel({
  ownFacilities,
  products,
  nextLotNr,
  onDone,
  cancellable,
}: {
  ownFacilities: WizardFacility[];
  products: WizardProduct[];
  nextLotNr: number;
  onDone: (createdId?: string) => void;
  cancellable: boolean;
}) {
  const router = useRouter();
  const [lotNr, setLotNr] = useState(String(nextLotNr));
  const [facilityId, setFacilityId] = useState(ownFacilities[0]?.id ?? "");
  const [poNumber, setPoNumber] = useState("");
  const [poDate, setPoDate] = useState("");
  const [lines, setLines] = useState<{ key: number; productId: string; units: string }[]>([{ key: 1, productId: "", units: "" }]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = lines.some((l) => l.productId || l.units.trim() !== "") || poNumber.trim() !== "" || poDate !== "";
  useDirtySection("new-lot", dirty, {
    label: "the new lot",
    save: async () => save(),
    discard: () => {
      setLines([{ key: 1, productId: "", units: "" }]);
      setPoNumber("");
      setPoDate("");
      setError(null);
    },
  });
  const productOptions = products.map((p) => ({
    value: p.id,
    label: p.code,
    hint: p.name,
    icon: <SkuAvatar code={p.code} size={20} imageUrl={p.imageUrl} />,
  }));

  async function save(): Promise<string | null> {
    setError(null);
    if (!facilityId) return fail("Pick the facility making this lot.");
    const clean = lines.filter((l) => l.productId).map((l) => ({ productId: l.productId, units: Number(l.units) || 0 }));
    if (clean.length === 0 || clean.some((l) => l.units <= 0)) return fail("Add at least one product with the units being made.");
    setPending(true);
    try {
      const r = await createOnboardingLot({ lotNr: Number(lotNr) || 0, poNumber: poNumber.trim() || null, poDateISO: poDate || null, facilityId, lines: clean });
      if (!r.ok) return fail(r.error ?? "Couldn't create the lot.");
      onDone(r.lotId);
      router.refresh();
      return null;
    } catch {
      return fail("Couldn't reach the server — try again.");
    } finally {
      setPending(false);
    }
  }
  function fail(msg: string): string {
    setError(msg);
    return msg;
  }

  return (
    <div className="rounded-[var(--radius-card)] border border-accent-strong bg-surface p-5">
      <div className="mb-4 text-[13px] font-semibold text-ink-soft">New lot in production</div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Lot number">
          <input type="number" min={1} value={lotNr} onChange={(e) => setLotNr(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Made at">
          <SelectMenu
            value={facilityId}
            onChange={setFacilityId}
            options={ownFacilities.map((f) => ({ value: f.id, label: f.code, hint: f.name }))}
            placeholder="Pick a facility"
          />
        </Field>
        <Field label="PO number (optional)">
          <input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} className={inputCls} placeholder={`#${lotNr || nextLotNr}`} />
        </Field>
        <Field label="Started on">
          <DatePicker value={poDate} onChange={setPoDate} />
        </Field>
      </div>
      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[12px] font-medium text-muted">Products being made</span>
          <button
            type="button"
            onClick={() => setLines((p) => [...p, { key: Date.now(), productId: "", units: "" }])}
            className="text-[12px] font-medium text-accent hover:underline"
          >
            + Add product
          </button>
        </div>
        <div className="space-y-2">
          {lines.map((ln) => (
            <div key={ln.key} className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <SelectMenu
                  value={ln.productId}
                  onChange={(v) => setLines((p) => p.map((x) => (x.key === ln.key ? { ...x, productId: v } : x)))}
                  options={productOptions.filter((o) => o.value === ln.productId || !lines.some((x) => x.productId === o.value))}
                  placeholder="Which product?"
                />
              </div>
              <input
                type="number"
                min={1}
                value={ln.units}
                onChange={(e) => setLines((p) => p.map((x) => (x.key === ln.key ? { ...x, units: e.target.value } : x)))}
                placeholder="Units"
                className="h-9 w-28 rounded-lg border border-border bg-surface px-2.5 text-right text-[13px] tabular text-ink outline-none focus:border-accent-strong"
              />
              <button
                type="button"
                onClick={() => setLines((p) => (p.length === 1 ? p : p.filter((x) => x.key !== ln.key)))}
                disabled={lines.length === 1}
                className="text-muted hover:text-negative disabled:opacity-30"
                title="Remove"
              >
                <X size={15} />
              </button>
            </div>
          ))}
        </div>
      </div>
      {error && <div className="mt-3 text-[12.5px] text-negative">{error}</div>}
      <div className="mt-4 flex justify-end gap-2">
        {cancellable && (
          <button type="button" onClick={() => onDone()} className="rounded-lg border border-border px-3.5 py-2 text-[13px] text-ink-soft hover:bg-surface-2">
            Cancel
          </button>
        )}
        <button type="button" onClick={() => void save()} disabled={pending} className="rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-bg hover:opacity-90 disabled:opacity-50">
          {pending ? "Creating…" : "Create lot"}
        </button>
      </div>
    </div>
  );
}

function WizardLotPanel({
  lot,
  ownFacilities,
  products,
  editing,
  open,
  onToggle,
  last,
}: {
  lot: WizardLot;
  ownFacilities: WizardFacility[];
  products: WizardProduct[];
  editing: LotEditing;
  open: boolean;
  onToggle: () => void;
  last: boolean;
}) {
  const router = useRouter();
  const { money } = useMoney();
  const [bridge, setBridge] = useState<{ save: () => Promise<string | null>; discard: () => void } | null>(null);
  const onDirtyState = useCallback((s: { save: () => Promise<string | null>; discard: () => void } | null) => setBridge(s), []);
  useDirtySection(`lot-${lot.id}`, !!bridge, {
    label: `lot #${lot.lotNr}`,
    save: () => (bridge ? bridge.save() : Promise.resolve(null)),
    discard: () => bridge?.discard(),
  });
  const facility = ownFacilities.find((f) => f.id === lot.initial.facilityId);
  const units = lot.initialLines.reduce((t, l) => t + l.units, 0);
  const slotId = `lot-status-slot-${lot.id}`;
  // Folded: the saved state's pills. Open: the editor portals live pills into the slot instead,
  // so staged status edits preview in the header exactly as on the lot page.
  const prod = deriveProduction(lot.initialLines);
  const pay = derivePayment(lot.initialLines);
  return (
    <div className={last ? "" : "border-b border-line"}>
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        aria-expanded={open}
        className={`flex cursor-pointer flex-wrap items-center gap-3 px-4 py-3 ${open ? "bg-surface-2" : "hover:bg-surface-2"}`}
      >
        <ChevronDown size={15} className={`shrink-0 text-muted transition-transform ${open ? "" : "-rotate-90"}`} />
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-ink">Lot #{lot.lotNr}</div>
          <div className="text-[12px] text-muted">
            {facility ? `${facility.code} · ${facility.name}` : "Facility"} · {lot.initialLines.map((l) => l.code).join(", ")} · {units.toLocaleString()} units
          </div>
        </div>
        {open ? (
          <span id={slotId} className="flex items-center gap-2" onClick={(e) => e.stopPropagation()} />
        ) : (
          <span className="flex items-center gap-2">
            <span className={`${DERIVED_PILL_CLS[prod]} inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-medium`}>
              {PRODUCTION_LABEL[prod]}
            </span>
            <span className={`${DERIVED_PILL_CLS[pay]} inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-medium`}>
              {PAYMENT_LABEL[pay]}
            </span>
          </span>
        )}
        <div className="ml-auto flex items-center gap-3">
          <div className="text-right">
            <div className="text-[10.5px] uppercase tracking-wide text-muted">Cost so far</div>
            <div className="tabular text-[13px] font-semibold text-ink">{money(lot.totalCog, 0)}</div>
          </div>
          <span onClick={(e) => e.stopPropagation()}>
            <DeleteX
              label={`lot #${lot.lotNr}`}
              onDelete={async () => {
                const r = await deleteOnboardingLot(lot.id);
                if (r.ok) router.refresh();
                return r;
              }}
            />
          </span>
        </div>
      </div>
      {open && (
        <div className="dropdown-in border-t border-line px-4 pb-5 pt-4">
          <LotEditor
            key={lot.updatedAt}
            lotId={lot.id}
            initial={lot.initial}
            initialLines={lot.initialLines}
            facilities={ownFacilities.map((f) => ({ id: f.id, code: f.code, name: f.name }))}
            products={products.map((p) => ({ id: p.id, code: p.code, name: p.name, imageUrl: p.imageUrl }))}
            materialTypes={editing.materialTypes}
            skuTxnCounts={lot.skuTxnCounts}
            totalCog={lot.totalCog}
            hideSaveBar
            onDirtyState={onDirtyState}
            statusSlotId={slotId}
            productionLocked
          />
          <div className="mt-8">
            <h3 className="mb-1 text-[14px] font-semibold text-ink">Production costs</h3>
            <p className="mb-3 text-[12.5px] text-muted">
              Payments already made for this run — add them as transactions, dated when they happened, and assign each line to the products it covers.
            </p>
            <TransactionInvoicesTable
              invoices={lot.invoices}
              lots={editing.lotOptions}
              suppliers={editing.suppliers}
              categories={editing.categories}
              skuImages={editing.skuImages}
              showLotColumn={false}
              defaultLotId={lot.id}
            />
          </div>
        </div>
      )}
    </div>
  );
}
