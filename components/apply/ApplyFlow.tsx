"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { ArrowRight, Check, ChevronLeft } from "@/components/icons";
import {
  ADS,
  BOOKKEEPING_TOOLS,
  CHALLENGE_MIN,
  CHANNELS,
  EMPTY_ANSWERS,
  FULFILLMENT,
  LONG_TERM_STOCK,
  LOT_TOOLS,
  choiceComplete,
  sharesComplete,
  sharesTotal,
  toggleChoice,
  validEmail,
  validPhone,
  type Answers,
} from "@/components/apply/options";
import { ChoiceCard, ChoiceGrid, Dropdown, Em, GHOST, Heading, Mark, Notice, PRIMARY, TextArea, TextField, Wordmark, fieldCls } from "@/components/apply/fields";
import { AccountStep } from "@/components/apply/AccountStep";
import { CalendlyStep } from "@/components/apply/CalendlyStep";
import { saveAnswers, saveContact, applicationState } from "@/app/apply/actions";

/**
 * The early-access application: a split screen — the offer on the left, one question at a time
 * on the right — that ends in account creation, a booked discovery call and the waiting screen.
 *
 * Answers live in this tab's sessionStorage so a refresh resumes where they were, and are written
 * to the server as they go: the row is created at the contact step (a drop-off is still a lead)
 * and updated after every later step, so the internal tooling sees exactly how far people got.
 */

type StepId =
  | "intro"
  | "contact"
  | "channels"
  | "mix"
  | "fulfillment"
  | "stock"
  | "lots"
  | "ads"
  | "books"
  | "challenge"
  | "result"
  | "account"
  | "book";

const STORAGE_KEY = "consl-apply-v1";
type Saved = { step: StepId; answers: Answers; applicationId: string | null; orgId: string | null };

const QUESTION_ORDER: StepId[] = ["contact", "channels", "mix", "fulfillment", "stock", "lots", "ads", "books", "challenge"];

const SECTION: Record<StepId, string> = {
  intro: "",
  contact: "About you",
  channels: "Where you sell",
  mix: "Your channel mix",
  fulfillment: "Fulfillment",
  stock: "Long-term stock",
  lots: "Production",
  ads: "Advertising",
  books: "Bookkeeping",
  challenge: "Your challenge",
  result: "",
  account: "Your account",
  book: "Your call",
};

const PERKS: { title: string; body: string }[] = [
  { title: "One of 20 seats.", body: "Early access is limited to twenty brands that make and sell physical products." },
  { title: "Lifetime 50% off.", body: "The early-access price is locked in for as long as you stay." },
  { title: "A personal brand manager.", body: "Sets the platform up with you, 1-1, until every number you care about lives in one place." },
];

export function ApplyFlow({ calendlyUrl }: { calendlyUrl: string | null }) {
  const [ready, setReady] = useState(false);
  const [step, setStep] = useState<StepId>("intro");
  const [answers, setAnswers] = useState<Answers>(EMPTY_ANSWERS);
  const [applicationId, setApplicationId] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [honeypot, setHoneypot] = useState("");
  const source = useRef<string | null>(null);
  const { user, isLoaded, isSignedIn } = useUser();

  // Someone already signed in (an applicant whose company was never created) shouldn't retype
  // what their login already knows.
  useEffect(() => {
    if (!ready || !user) return;
    setAnswers((a) =>
      a.fullName || a.email ? a : { ...a, fullName: user.fullName ?? "", email: user.primaryEmailAddress?.emailAddress ?? "" },
    );
  }, [ready, user]);

  // Resume after a refresh: everything typed so far lives in sessionStorage for this tab — but
  // only if the application it belongs to still exists on the server. A row that was deleted
  // underneath the browser (a wiped test company, an admin clean-up) is not resumed: the saved
  // progress is dropped and the form starts from scratch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let saved: Partial<Saved> | null = null;
      try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        if (raw) saved = JSON.parse(raw) as Partial<Saved>;
        source.current = new URLSearchParams(window.location.search).get("utm_source");
      } catch {
        /* private mode etc. — the form still works, it just won't survive a refresh */
      }
      if (saved?.applicationId) {
        const state = await applicationState(saved.applicationId).catch(() => null);
        if (state && !state.exists) {
          try {
            sessionStorage.removeItem(STORAGE_KEY);
          } catch {
            /* ignore */
          }
          saved = null;
        }
      }
      if (cancelled) return;
      if (saved) {
        if (saved.step) setStep(saved.step);
        if (saved.answers) setAnswers({ ...EMPTY_ANSWERS, ...saved.answers });
        setApplicationId(saved.applicationId ?? null);
        setOrgId(saved.orgId ?? null);
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // The booking step belongs to a signed-in applicant with a company. Resumed while signed out
  // (the login was removed, the session expired), it steps back to the account step — adjusted
  // during render, React's pattern for state that depends on something outside it.
  if (ready && isLoaded && !isSignedIn && step === "book") setStep("account");
  useEffect(() => {
    if (!ready) return;
    try {
      const snapshot: Saved = { step, answers, applicationId, orgId };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      /* ignore */
    }
  }, [ready, step, answers, applicationId, orgId]);

  function set<K extends keyof Answers>(k: K, v: Answers[K]) {
    setAnswers((a) => ({ ...a, [k]: v }));
  }

  // The visible question steps — the channel-mix step only exists with two or more channels.
  const questions = useMemo(
    () => QUESTION_ORDER.filter((s) => s !== "mix" || answers.channels.length > 1),
    [answers.channels.length],
  );
  const order = useMemo<StepId[]>(() => ["intro", ...questions, "result", "account", "book"], [questions]);
  const qIndex = questions.indexOf(step);

  const valid: Record<StepId, boolean> = {
    intro: true,
    contact:
      answers.fullName.trim().length >= 2 &&
      answers.companyName.trim().length >= 2 &&
      validEmail(answers.email) &&
      validPhone(answers.phone),
    channels: choiceComplete(answers.channels, answers.channelOther),
    mix: sharesComplete(answers),
    fulfillment: choiceComplete(answers.fulfillment, answers.fulfillmentOther),
    stock: choiceComplete(answers.longTermStock, answers.longTermStockOther),
    lots:
      answers.lotTracking === "no" ||
      (answers.lotTracking === "yes" && !!answers.lotTrackingTool && answers.lotTrackingHow.trim().length >= 10),
    ads: choiceComplete(answers.ads, answers.adsOther),
    books: !!answers.bookkeepingTool && answers.bookkeeping.trim().length >= 10,
    challenge: answers.challenge.trim().length >= CHALLENGE_MIN,
    result: true,
    account: true,
    book: true,
  };

  /** Write progress before moving on. Only the very first save (creating the row) can hold the
   *  visitor up; every later one is fire-and-forget, retried implicitly by the next step. */
  async function persist(next: StepId): Promise<boolean> {
    if (step === "contact" && !applicationId) {
      setSaving(true);
      setSaveError(null);
      try {
        const res = await saveContact({
          fullName: answers.fullName,
          companyName: answers.companyName,
          email: answers.email,
          phone: answers.phone,
          website: honeypot,
          source: source.current ?? undefined,
        });
        if (!res.ok) {
          setSaveError(res.error);
          return false;
        }
        setApplicationId(res.id);
        return true;
      } catch {
        setSaveError("We couldn't save that just now. Check your connection and try again.");
        return false;
      } finally {
        setSaving(false);
      }
    }
    if (applicationId) {
      saveAnswers(applicationId, answers, { complete: next === "result" }).catch(() => {});
    }
    return true;
  }

  /** The server lost our row (it was deleted underneath us): create a fresh one from the answers
   *  in this tab, so the account step can link it. */
  async function recreateApplication(): Promise<string | null> {
    try {
      const res = await saveContact({
        fullName: answers.fullName,
        companyName: answers.companyName,
        email: answers.email,
        phone: answers.phone,
        website: honeypot,
        source: source.current ?? undefined,
      });
      if (!res.ok) return null;
      await saveAnswers(res.id, answers, { complete: true }).catch(() => {});
      setApplicationId(res.id);
      return res.id;
    } catch {
      return null;
    }
  }

  async function goNext() {
    if (!valid[step] || saving) return;
    const next = order[order.indexOf(step) + 1];
    if (!next) return;
    if (!(await persist(next))) return;
    setStep(next);
  }
  function goBack() {
    const prev = order[order.indexOf(step) - 1];
    if (prev) setStep(prev);
  }
  function toggleChannel(key: string) {
    const channels = toggleChoice(CHANNELS, answers.channels, key);
    // Shares only make sense for channels still picked.
    const shares = Object.fromEntries(Object.entries(answers.shares).filter(([k]) => channels.includes(k)));
    setAnswers((a) => ({ ...a, channels, shares }));
  }

  if (!ready) return <div className="min-h-screen bg-white" />;

  const counter =
    qIndex >= 0 ? (
      <>
        <span className="font-semibold text-neutral-900">
          {qIndex + 1}/{questions.length}
        </span>
        <span className="ml-2.5 text-neutral-500">{SECTION[step]}</span>
      </>
    ) : SECTION[step] ? (
      <span className="text-neutral-500">{SECTION[step]}</span>
    ) : null;

  return (
    <div className="min-h-screen bg-white text-neutral-900 lg:grid lg:grid-cols-[5fr_7fr]" style={{ colorScheme: "light" }}>
      <Aside />
      <main className="flex min-h-[70vh] flex-col lg:min-h-screen">
        <div className="flex items-center justify-between gap-4 px-6 py-5 text-[13.5px] lg:px-16 lg:py-7">
          <div className="min-h-[20px]">{counter}</div>
          {step !== "book" && step !== "account" && (
            <div className="text-neutral-500">
              Already have an account?{" "}
              <Link href="/sign-in" className="font-semibold text-violet-700 hover:text-violet-800">
                Log in
              </Link>
            </div>
          )}
        </div>
        <div className="flex-1 px-6 pb-16 pt-2 lg:px-16 lg:pt-8">
          <div key={step} className={`step-in mx-auto w-full lg:mx-0 ${step === "book" ? "max-w-none" : "max-w-[640px]"}`}>
            {step === "intro" && (
              <Form onNext={goNext}>
                <div className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-3.5 py-1.5 text-[12.5px] font-semibold text-violet-800">
                  Limited to 20 spots
                </div>
                <div className="mt-5">
                  <Heading
                    title={
                      <>
                        First, tell us how your brand operates and <Em>where your numbers get lost</Em>.
                      </>
                    }
                    sub="Before your discovery call, we want to understand your brand and what's slowing you down, so we can help as much as possible and make sure consl and our team of e-commerce experts are the right tool for your business."
                  />
                </div>
                <p className="mt-4 max-w-[560px] text-[15.5px] leading-relaxed text-neutral-600">
                  We work 1-1 with the first twenty brands that get in, and we work relentlessly: until your numbers are true to
                  the cent and you see your whole inventory, production and profit in real time, in one place. We just need to make
                  sure we&apos;re a great fit first.
                </p>
                <p className="mt-3 max-w-[560px] text-[14px] leading-relaxed text-neutral-500">
                  About three minutes. Everything you type is saved as you go.
                </p>
                <Nav hideBack canNext nextLabel="Start" />
              </Form>
            )}

            {step === "contact" && (
              <Form onNext={goNext}>
                <Heading
                  title={
                    <>
                      First, a bit <Em>about you</Em>.
                    </>
                  }
                  sub="So your brand manager knows who they're talking to."
                />
                <div className="mt-8 grid gap-4 sm:grid-cols-2">
                  <TextField label="Full name" value={answers.fullName} onChange={(v) => set("fullName", v)} placeholder="Jane Doe" autoFocus autoComplete="name" error={answers.fullName.trim().length < 2 ? "Your full name, please." : null} />
                  <TextField label="Company name" value={answers.companyName} onChange={(v) => set("companyName", v)} placeholder="Northwind Coffee" autoComplete="organization" error={answers.companyName.trim().length < 2 ? "What's the brand called?" : null} />
                  <TextField label="Work email" type="email" inputMode="email" value={answers.email} onChange={(v) => set("email", v)} placeholder="jane@northwind.com" autoComplete="email" error={!validEmail(answers.email) ? "That email doesn't look right." : null} />
                  <TextField label="Work phone" type="tel" inputMode="tel" value={answers.phone} onChange={(v) => set("phone", v)} placeholder="+1 555 123 4567" autoComplete="tel" error={!validPhone(answers.phone) ? "A number we can reach you on." : null} />
                </div>
                {/* Honeypot: never shown to people. Bots that fill it get a polite fake success. */}
                <input type="text" name="website" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden className="hidden" />
                {saveError && (
                  <div className="mt-4">
                    <Notice tone="error">{saveError}</Notice>
                  </div>
                )}
                <Nav onBack={goBack} canNext={valid.contact} pending={saving} />
              </Form>
            )}

            {step === "channels" && (
              <Form onNext={goNext}>
                <Heading
                  title={
                    <>
                      Where do you <Em>sell</Em> right now?
                    </>
                  }
                  sub="Pick every channel you sell on today."
                />
                <div className="mt-8">
                  <ChoiceGrid choices={CHANNELS} value={answers.channels} onToggle={toggleChannel} other={answers.channelOther} onOther={(v) => set("channelOther", v)} otherPlaceholder="Where else do you sell?" />
                </div>
                <Nav onBack={goBack} canNext={valid.channels} />
              </Form>
            )}

            {step === "mix" && (
              <Form onNext={goNext}>
                <Heading
                  title={
                    <>
                      Which one is your <Em>main channel</Em>?
                    </>
                  }
                  sub="Give us a ballpark share of sales for each. It doesn't have to add up perfectly."
                />
                <ChannelMix answers={answers} onShare={(k, v) => set("shares", { ...answers.shares, [k]: v })} />
                <Nav onBack={goBack} canNext={valid.mix} />
              </Form>
            )}

            {step === "fulfillment" && (
              <Form onNext={goNext}>
                <Heading
                  title={
                    <>
                      How are you <Em>fulfilling orders</Em> today?
                    </>
                  }
                  sub="Pick everything that applies."
                />
                <div className="mt-8">
                  <ChoiceGrid choices={FULFILLMENT} value={answers.fulfillment} onToggle={(k) => set("fulfillment", toggleChoice(FULFILLMENT, answers.fulfillment, k))} other={answers.fulfillmentOther} onOther={(v) => set("fulfillmentOther", v)} otherPlaceholder="How do orders get shipped?" />
                </div>
                <Nav onBack={goBack} canNext={valid.fulfillment} />
              </Form>
            )}

            {step === "stock" && (
              <Form onNext={goNext}>
                <Heading
                  title={
                    <>
                      Do you hold <Em>long-term stock</Em> anywhere else?
                    </>
                  }
                  sub="Beyond what's sitting at the channels themselves."
                />
                <div className="mt-8">
                  <ChoiceGrid choices={LONG_TERM_STOCK} value={answers.longTermStock} onToggle={(k) => set("longTermStock", toggleChoice(LONG_TERM_STOCK, answers.longTermStock, k))} other={answers.longTermStockOther} onOther={(v) => set("longTermStockOther", v)} otherPlaceholder="Where does it sit?" />
                </div>
                <Nav onBack={goBack} canNext={valid.stock} />
              </Form>
            )}

            {step === "lots" && (
              <Form onNext={goNext}>
                <Heading
                  title={
                    <>
                      Do you keep track of your <Em>production lots</Em>?
                    </>
                  }
                  sub="Batches, runs, what went into them and what each one cost."
                />
                <div className="mt-8 grid gap-2.5 sm:grid-cols-2">
                  <ChoiceCard selected={answers.lotTracking === "yes"} onClick={() => set("lotTracking", "yes")} label="Yes, we track them" hint="Somehow, somewhere" />
                  <ChoiceCard selected={answers.lotTracking === "no"} onClick={() => set("lotTracking", "no")} label="Not really" hint="It lives in our heads, or nowhere" />
                </div>
                {answers.lotTracking === "yes" && (
                  <div className="step-in mt-5 space-y-4">
                    <Dropdown label="How do you track them today?" value={answers.lotTrackingTool} options={LOT_TOOLS} onChange={(v) => set("lotTrackingTool", v)} />
                    <TextArea label="Tell us a little more" value={answers.lotTrackingHow} onChange={(v) => set("lotTrackingHow", v)} placeholder="What do you record per lot, and where does it break down?" rows={4} hint="A couple of sentences is plenty." />
                  </div>
                )}
                {answers.lotTracking === "no" && (
                  <div className="step-in mt-5">
                    <TextArea label="What happens today instead? (optional)" value={answers.lotTrackingHow} onChange={(v) => set("lotTrackingHow", v)} placeholder="e.g. Our co-packer sends a PDF per run and we file it." rows={3} />
                  </div>
                )}
                <Nav onBack={goBack} canNext={valid.lots} />
              </Form>
            )}

            {step === "ads" && (
              <Form onNext={goNext}>
                <Heading
                  title={
                    <>
                      Where do you <Em>advertise</Em>?
                    </>
                  }
                  sub="Ad spend lands on your P&L in consl, so we'd like to know where it comes from."
                />
                <div className="mt-8">
                  <ChoiceGrid choices={ADS} value={answers.ads} onToggle={(k) => set("ads", toggleChoice(ADS, answers.ads, k))} other={answers.adsOther} onOther={(v) => set("adsOther", v)} otherPlaceholder="Where else?" />
                </div>
                <Nav onBack={goBack} canNext={valid.ads} />
              </Form>
            )}

            {step === "books" && (
              <Form onNext={goNext}>
                <Heading
                  title={
                    <>
                      How do you do your <Em>bookkeeping and P&amp;L</Em> today?
                    </>
                  }
                  sub="Tools, people, spreadsheets, vibes. All valid answers."
                />
                <div className="mt-8 space-y-4">
                  <Dropdown label="What do you use?" value={answers.bookkeepingTool} options={BOOKKEEPING_TOOLS} onChange={(v) => set("bookkeepingTool", v)} />
                  <TextArea label="How do you see your profit today?" value={answers.bookkeeping} onChange={(v) => set("bookkeeping", v)} placeholder="e.g. Our accountant closes the month in QuickBooks; I keep a spreadsheet for margins per SKU." rows={4} hint="A couple of sentences is plenty." />
                </div>
                <Nav onBack={goBack} canNext={valid.books} />
              </Form>
            )}

            {step === "challenge" && (
              <Form onNext={goNext}>
                <Heading
                  title={
                    <>
                      What&apos;s your <Em>main challenge</Em> right now?
                    </>
                  }
                  sub="And why do you think consl can help with it? This is the answer we read most carefully."
                />
                <div className="mt-8">
                  <TextArea value={answers.challenge} onChange={(v) => set("challenge", v)} placeholder="Be specific: the numbers you can't see, the spreadsheet that keeps breaking, the decisions you're making blind…" rows={7} minChars={CHALLENGE_MIN} autoFocus />
                </div>
                <Nav onBack={goBack} canNext={valid.challenge} nextLabel="Finish" />
              </Form>
            )}

            {step === "result" && (
              <Form onNext={goNext}>
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-100 text-violet-700">
                  <Check size={22} />
                </span>
                <div className="mt-5">
                  <Heading
                    title={
                      <>
                        Based on your replies, we think you could be a <Em>great fit</Em>.
                      </>
                    }
                    sub="Next: create your account and book your discovery call. Your personal brand manager will walk you through the setup and start your 14-day free trial on that call, at the lifetime early-access price."
                  />
                </div>
                <ol className="mt-7 space-y-3">
                  {[
                    ["Create your account", "Thirty seconds. Your details are already filled in."],
                    ["Pick a time for your discovery call", "Straight from the next screen."],
                    ["Meet your brand manager", "Set up the platform together and start your trial on the call."],
                  ].map(([t, b], i) => (
                    <li key={t} className="flex items-start gap-3.5">
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-[12px] font-semibold text-white">{i + 1}</span>
                      <span>
                        <span className="block text-[15px] font-medium text-neutral-900">{t}</span>
                        <span className="block text-[13.5px] text-neutral-500">{b}</span>
                      </span>
                    </li>
                  ))}
                </ol>
                <Nav onBack={goBack} canNext nextLabel="Create my account" />
              </Form>
            )}

            {step === "account" &&
              (applicationId ? (
                <AccountStep
                  applicationId={applicationId}
                  answers={answers}
                  onChange={set}
                  onBack={goBack}
                  onDone={(id) => {
                    setOrgId(id);
                    setStep("book");
                  }}
                  onApplicationLost={recreateApplication}
                />
              ) : (
                <Restart />
              ))}

            {step === "book" &&
              (applicationId ? (
                <CalendlyStep
                  url={calendlyUrl}
                  name={answers.fullName}
                  email={answers.email}
                  applicationId={applicationId}
                  onBooked={() => {
                    try {
                      sessionStorage.removeItem(STORAGE_KEY);
                    } catch {
                      /* ignore */
                    }
                    // A full navigation, not a client transition: the app layout must re-run with
                    // the new company cookie to land them on their waiting screen.
                    window.location.href = "/pre-onboarding";
                  }}
                />
              ) : (
                <Restart />
              ))}
          </div>
        </div>
      </main>
    </div>
  );
}

/** Every question is a form so Enter in a text field advances when the step is valid. */
function Form({ onNext, children }: { onNext: () => void; children: ReactNode }) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onNext();
      }}
    >
      {children}
    </form>
  );
}

function Nav({
  onBack,
  canNext,
  nextLabel = "Next",
  pending = false,
  hideBack = false,
}: {
  onBack?: () => void;
  canNext: boolean;
  nextLabel?: string;
  pending?: boolean;
  hideBack?: boolean;
}) {
  return (
    <div className="mt-9 flex items-center justify-between gap-3">
      {hideBack ? (
        <span />
      ) : (
        <button type="button" onClick={onBack} className={GHOST}>
          <ChevronLeft size={16} />
          Back
        </button>
      )}
      <button type="submit" disabled={!canNext || pending} className={PRIMARY}>
        {pending ? "Saving…" : nextLabel}
        {!pending && <ArrowRight size={16} />}
      </button>
    </div>
  );
}

/** The channel-mix step: one row per picked channel with a percent box; ranks follow the numbers. */
function ChannelMix({ answers, onShare }: { answers: Answers; onShare: (key: string, v: number | "") => void }) {
  const typed = answers.channels.filter((k) => typeof answers.shares[k] === "number");
  const ranking = [...typed].sort((a, b) => (answers.shares[b] as number) - (answers.shares[a] as number));
  const total = sharesTotal(answers);
  const ok = sharesComplete(answers);
  return (
    <div className="mt-8">
      <div className="space-y-2.5">
        {answers.channels.map((k) => {
          const c = CHANNELS.find((x) => x.key === k)!;
          const share = answers.shares[k] ?? "";
          const isMain = ranking[0] === k && typed.length > 0 && (answers.shares[k] as number) > 0;
          return (
            <div
              key={k}
              className={`flex items-center gap-3.5 rounded-2xl border bg-white px-4 py-3 transition-colors ${
                isMain ? "border-violet-500 shadow-[0_0_0_1px_#7c3aed]" : "border-neutral-200"
              }`}
            >
              <Mark choice={c} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-medium text-neutral-900">{k === "other" ? answers.channelOther.trim() || "Other" : c.label}</div>
                {isMain && <div className="text-[12px] font-semibold text-violet-700">Main channel</div>}
              </div>
              <label className="relative block w-[104px]">
                <input
                  type="text"
                  inputMode="numeric"
                  value={share}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, "").slice(0, 3);
                    onShare(k, digits === "" ? "" : Math.min(100, Number(digits)));
                  }}
                  placeholder="0"
                  aria-label={`Share of sales on ${c.label}`}
                  className={`${fieldCls} h-11 pr-9 text-right tabular-nums`}
                />
                <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-[14px] text-neutral-400">%</span>
              </label>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex items-center justify-between text-[13.5px]">
        <span className="text-neutral-500">Ballpark is fine. Aim for about 100%.</span>
        <span className={`tabular-nums font-medium ${ok ? "text-emerald-600" : "text-neutral-700"}`}>
          {ok && <Check size={13} className="mr-1 inline-block" />}
          Total {total}%
        </span>
      </div>
    </div>
  );
}

function Restart() {
  return (
    <div>
      <Heading title={<>Let&apos;s pick this back up.</>} sub="We lost track of your application in this browser. Start again and it only takes a few minutes." />
      <div className="mt-8">
        <a href="/apply" className={PRIMARY}>
          Start again
          <ArrowRight size={16} />
        </a>
      </div>
    </div>
  );
}

/** The left panel: the offer, always in view. Collapses to a compact header on phones. */
function Aside() {
  return (
    <aside className="relative overflow-hidden border-b border-neutral-200 bg-neutral-50 px-6 py-5 lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r lg:px-12 lg:py-10">
      <Link href="/home" aria-label="consl home" className="inline-flex">
        <Wordmark />
      </Link>
      <div className="mt-6 lg:mt-16">
        <h2 className="text-[26px] font-bold leading-[1.08] tracking-tight text-violet-700 lg:text-[40px]">Apply for early access.</h2>
        <p className="mt-1.5 text-[17px] font-semibold text-neutral-800 lg:mt-3 lg:text-[26px]">Twenty spots, for the brands we&apos;re the right fit for.</p>
      </div>
      <ul className="mt-9 hidden max-w-[420px] space-y-3.5 lg:block">
        {PERKS.map((p) => (
          <li key={p.title} className="flex items-start gap-3 text-[14.5px] leading-snug">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-700">
              <Check size={12} />
            </span>
            <span>
              <span className="font-semibold text-neutral-900">{p.title}</span> <span className="text-neutral-600">{p.body}</span>
            </span>
          </li>
        ))}
      </ul>
      {/* The product, peeking in from the bottom edge like a desk under the pitch. */}
      <div aria-hidden className="pointer-events-none absolute left-12 top-[560px] hidden w-[125%] lg:block">
        <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_24px_70px_-28px_rgba(76,29,149,0.35)]">
          <div className="flex items-center gap-1.5 border-b border-neutral-200 bg-neutral-50 px-4 py-2.5">
            <span className="h-2.5 w-2.5 rounded-full bg-neutral-300" />
            <span className="h-2.5 w-2.5 rounded-full bg-neutral-300" />
            <span className="h-2.5 w-2.5 rounded-full bg-neutral-300" />
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/marketing/dashboard.jpg" alt="" className="block w-full" />
        </div>
      </div>
    </aside>
  );
}
