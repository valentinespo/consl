"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth, useClerk, useSignIn, useSignUp } from "@clerk/nextjs";
import { ArrowRight, ChevronLeft } from "@/components/icons";
import { Em, GHOST, Heading, Notice, PRIMARY, RuleList, TextField, fieldCls } from "@/components/apply/fields";
import type { Answers } from "@/components/apply/options";
import {
  DEFAULT_PASSWORD_SETTINGS,
  normalizePasswordSettings,
  passwordRules,
  rulesSatisfied,
  type PasswordSettings,
} from "@/components/apply/password-rules";
import { useStrength } from "@/components/apply/useStrength";
import { attachAccount } from "@/app/apply/actions";

/**
 * Account creation as a step of the questionnaire, not a detour to Clerk's own page: name,
 * company and email are already filled in from the answers, so all that's asked is a password.
 *
 * Built on Clerk's custom-flow API. When "Verify at sign-up" is off in the Clerk dashboard the
 * account is created in one call; when it's on, the email-code step appears here in the same
 * look rather than breaking the flow. An email that already has an account turns the step into
 * a sign-in. Once a session exists, the company is created server-side and linked to the
 * application, and the flow moves on to booking.
 */

type Mode = "form" | "verify" | "signin" | "signin-code";

/** The password rules the loaded Clerk client reports for this instance; the defaults until then. */
function useClerkPasswordSettings(): PasswordSettings {
  const clerk = useClerk();
  return useMemo(() => {
    if (!clerk.loaded || typeof window === "undefined") return DEFAULT_PASSWORD_SETTINGS;
    const raw = (window as unknown as { Clerk?: { environment?: { userSettings?: { passwordSettings?: unknown } } } }).Clerk
      ?.environment?.userSettings?.passwordSettings;
    return raw ? normalizePasswordSettings(raw) : DEFAULT_PASSWORD_SETTINGS;
  }, [clerk.loaded]);
}

type ClerkLikeError = { code: string; message: string; longMessage?: string; meta?: unknown; errors?: { code: string; message: string; longMessage?: string; meta?: unknown }[] };

/** The specific error, not the envelope: Clerk hands back a response error whose own code is the
 *  generic "api_response_error", with the real one ("form_identifier_exists", …) in errors[0]. */
function specific(error: ClerkLikeError): { code: string; message: string; longMessage?: string; meta?: unknown } {
  return error.errors?.[0] ?? error;
}

/** Clerk's own wording for a refused password is terse ("not strong enough"); say what to do instead. */
function passwordProblem(raw: ClerkLikeError): string | null {
  const error = specific(raw);
  if (error.code === "form_password_pwned") {
    return "That password has shown up in a known data breach, so it can't be used here. Pick a different one.";
  }
  if (error.code.startsWith("form_password_")) {
    const meta = error.meta as { zxcvbn?: { suggestions?: { message: string }[] } } | undefined;
    const tips = meta?.zxcvbn?.suggestions?.map((t) => t.message).filter(Boolean) ?? [];
    return [error.longMessage ?? error.message, ...tips].join(" ");
  }
  return null;
}

export function AccountStep({
  applicationId,
  answers,
  onChange,
  onBack,
  onDone,
  onApplicationLost,
}: {
  applicationId: string;
  answers: Answers;
  onChange: <K extends keyof Answers>(k: K, v: Answers[K]) => void;
  onBack: () => void;
  onDone: (orgId: string) => void;
  /** The saved row vanished server-side: rebuild it from the answers in this browser. Resolves to
   *  the new id (which arrives here as a new `applicationId` prop and retries the link) or null. */
  onApplicationLost: () => Promise<string | null>;
}) {
  const { signUp, fetchStatus: signUpFetch } = useSignUp();
  const { signIn, fetchStatus: signInFetch } = useSignIn();
  const { isSignedIn } = useAuth();
  const [mode, setMode] = useState<Mode>("form");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkAttempt, setLinkAttempt] = useState(0);
  const busy = signUpFetch === "fetching" || signInFetch === "fetching";
  const settings = useClerkPasswordSettings();
  const strength = useStrength(password);
  const rules = passwordRules(password, settings, strength);
  const passwordOk = rulesSatisfied(rules);

  const email = answers.email.trim().toLowerCase();
  const [firstName, ...rest] = answers.fullName.trim().split(/\s+/);
  const lastName = rest.join(" ");

  // The moment a session exists — a fresh sign-up, a sign-in, or someone already signed in when
  // they arrive — the company is created server-side and linked to the application.
  const linking = !!isSignedIn;
  useEffect(() => {
    if (!linking) return;
    let cancelled = false;
    attachAccount(applicationId)
      .then(async (res) => {
        if (cancelled) return;
        if (res.ok) return onDone(res.orgId);
        if (res.code === "not_found") {
          // Rebuild the row from the answers still in this tab; the new id re-runs this effect.
          const id = await onApplicationLost();
          if (!cancelled && !id) setLinkError("We couldn't recover your application. Please start again from the home page.");
          return;
        }
        setLinkError(res.error);
      })
      .catch(() => {
        if (!cancelled) setLinkError("Something went wrong setting up your workspace. Try again.");
      });
    return () => {
      cancelled = true;
    };
    // onDone is a stable parent callback; re-running on every render would double-create.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linking, applicationId, linkAttempt]);

  const describe = (e: ClerkLikeError) => {
    const s = specific(e);
    return s.longMessage ?? s.message;
  };

  async function submitSignUp(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!signUp) return;
    const { error } = await signUp.password({
      emailAddress: email,
      password,
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      unsafeMetadata: { applicationId, companyName: answers.companyName.trim() },
    });
    if (error) {
      if (specific(error).code === "form_identifier_exists") {
        setMode("signin");
        setMessage("You already have a consl account with this email. Sign in with your password to continue.");
        return;
      }
      setMessage(passwordProblem(error) ?? describe(error));
      return;
    }
    await afterSignUp();
  }

  async function afterSignUp() {
    if (!signUp) return;
    if (signUp.status === "complete") {
      const { error } = await signUp.finalize();
      if (error) return setMessage(describe(error));
      return; // the session appears → linking starts
    }
    if (signUp.status === "missing_requirements" && signUp.unverifiedFields.includes("email_address")) {
      const { error } = await signUp.verifications.sendEmailCode();
      if (error) return setMessage(describe(error));
      setMode("verify");
      return;
    }
    setMessage("We couldn't finish creating your account here. Please try again, or use the sign-up page.");
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!signUp) return;
    const { error } = await signUp.verifications.verifyEmailCode({ code: code.trim() });
    if (error) return setMessage(describe(error));
    if (signUp.status === "complete") {
      const r = await signUp.finalize();
      if (r.error) return setMessage(describe(r.error));
    } else {
      setMessage("That code didn't go through. Check it and try again.");
    }
  }

  async function submitSignIn(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!signIn) return;
    const { error } = await signIn.password({ emailAddress: email, password });
    if (error) return setMessage(describe(error));
    if (signIn.status === "complete") {
      const r = await signIn.finalize();
      if (r.error) return setMessage(describe(r.error));
      return;
    }
    if (signIn.status === "needs_client_trust") {
      const emailCode = signIn.supportedSecondFactors?.find((f) => f.strategy === "email_code");
      if (emailCode) {
        const r = await signIn.mfa.sendEmailCode();
        if (r.error) return setMessage(describe(r.error));
        setMode("signin-code");
        return;
      }
    }
    if (signIn.status === "needs_second_factor") {
      setMessage("This account uses two-step sign-in. Log in on the sign-in page first, then come back to this tab.");
      return;
    }
    setMessage("We couldn't sign you in here. Try the sign-in page.");
  }

  async function submitSignInCode(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!signIn) return;
    const { error } = await signIn.mfa.verifyEmailCode({ code: code.trim() });
    if (error) return setMessage(describe(error));
    if (signIn.status === "complete") {
      const r = await signIn.finalize();
      if (r.error) return setMessage(describe(r.error));
    } else {
      setMessage("That code didn't go through. Check it and try again.");
    }
  }

  if (linking) {
    return (
      <div>
        <Heading
          title={
            <>
              Setting up <Em>{answers.companyName.trim() || "your workspace"}</Em>…
            </>
          }
          sub={linkError ? undefined : "One moment. Your workspace is being created and linked to your application."}
        />
        {linkError ? (
          <div className="mt-6 space-y-4">
            <Notice tone="error">{linkError}</Notice>
            <button
              type="button"
              onClick={() => {
                setLinkError(null);
                setLinkAttempt((n) => n + 1);
              }}
              className={PRIMARY}
            >
              Try again
              <ArrowRight size={16} />
            </button>
          </div>
        ) : (
          <div className="mt-8 flex items-center gap-3 text-[14px] text-neutral-500">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-300 border-t-violet-600" />
            Creating your workspace
          </div>
        )}
      </div>
    );
  }

  if (mode === "verify" || mode === "signin-code") {
    const onSubmit = mode === "verify" ? submitCode : submitSignInCode;
    return (
      <form onSubmit={onSubmit}>
        <Heading
          title={
            <>
              Check your <Em>email</Em>.
            </>
          }
          sub={
            <>
              We sent a six-digit code to <span className="font-medium text-neutral-900">{email}</span>. Enter it here and you&apos;re in.
            </>
          }
        />
        <div className="mt-8 max-w-[260px]">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            autoFocus
            aria-label="Verification code"
            className={`${fieldCls} h-14 text-center text-[24px] font-semibold tracking-[0.35em] tabular-nums`}
          />
        </div>
        {message && (
          <div className="mt-4">
            <Notice tone="error">{message}</Notice>
          </div>
        )}
        <div className="mt-9 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setMode(mode === "verify" ? "form" : "signin")} className={GHOST}>
              <ChevronLeft size={16} />
              Back
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setMessage(null);
                const r = mode === "verify" ? await signUp?.verifications.sendEmailCode() : await signIn?.mfa.sendEmailCode();
                if (r?.error) setMessage(describe(r.error));
                else setMessage("A fresh code is on its way.");
              }}
              className="text-[13.5px] font-semibold text-neutral-500 hover:text-neutral-800"
            >
              Resend code
            </button>
          </div>
          <button type="submit" disabled={busy || code.length < 6} className={PRIMARY}>
            {busy ? "Checking…" : "Verify"}
            {!busy && <ArrowRight size={16} />}
          </button>
        </div>
      </form>
    );
  }

  if (mode === "signin") {
    return (
      <form onSubmit={submitSignIn}>
        <Heading
          title={
            <>
              Welcome <Em>back</Em>.
            </>
          }
          sub={
            <>
              Sign in as <span className="font-medium text-neutral-900">{email}</span> to link this application to your account.
            </>
          }
        />
        {message && (
          <div className="mt-5">
            <Notice tone={message.startsWith("You already") ? "neutral" : "error"}>{message}</Notice>
          </div>
        )}
        <div className="mt-6">
          <TextField
            label="Password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={setPassword}
            autoFocus
            autoComplete="current-password"
            trailing={<ShowHide shown={showPassword} onToggle={() => setShowPassword((s) => !s)} />}
          />
          <div className="mt-2 text-[13px]">
            <Link href={`/sign-in?redirect_url=${encodeURIComponent("/apply")}`} className="font-semibold text-neutral-500 hover:text-neutral-800">
              Forgot your password?
            </Link>
          </div>
        </div>
        <div className="mt-9 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              setMode("form");
              setMessage(null);
            }}
            className={GHOST}
          >
            <ChevronLeft size={16} />
            Use another email
          </button>
          <button type="submit" disabled={busy || password.length === 0} className={PRIMARY}>
            {busy ? "Signing in…" : "Sign in & continue"}
            {!busy && <ArrowRight size={16} />}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={submitSignUp}>
      <Heading
        title={
          <>
            Create your <Em>account</Em>.
          </>
        }
        sub="Your details are already filled in. Pick a password and you're in."
      />
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <TextField label="Full name" value={answers.fullName} onChange={(v) => onChange("fullName", v)} autoComplete="name" />
        <TextField label="Brand" value={answers.companyName} onChange={(v) => onChange("companyName", v)} autoComplete="organization" />
        <div className="sm:col-span-2">
          <TextField label="Work email" type="email" inputMode="email" value={answers.email} onChange={(v) => onChange("email", v)} autoComplete="email" />
        </div>
        <div className="sm:col-span-2">
          <TextField
            label="Password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={setPassword}
            placeholder="Choose a password"
            autoFocus
            autoComplete="new-password"
            trailing={<ShowHide shown={showPassword} onToggle={() => setShowPassword((s) => !s)} />}
          />
          <RuleList rules={rules} />
        </div>
      </div>
      {message && (
        <div className="mt-4">
          <Notice tone="error">{message}</Notice>
        </div>
      )}
      <p className="mt-4 text-[12.5px] leading-relaxed text-neutral-500">
        By continuing you agree to consl&apos;s{" "}
        <Link href="/terms" className="font-medium text-neutral-700 underline-offset-2 hover:underline">
          Terms
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="font-medium text-neutral-700 underline-offset-2 hover:underline">
          Privacy Policy
        </Link>
        .
      </p>
      {/* Clerk mounts its bot check here when the instance has it on; empty otherwise. */}
      <div id="clerk-captcha" className="mt-3 empty:hidden" />
      <div className="mt-9 flex items-center justify-between gap-3">
        <button type="button" onClick={onBack} className={GHOST}>
          <ChevronLeft size={16} />
          Back
        </button>
        <button type="submit" disabled={busy || !signUp || !passwordOk} className={PRIMARY}>
          {busy ? "Creating…" : "Create account"}
          {!busy && <ArrowRight size={16} />}
        </button>
      </div>
    </form>
  );
}

function ShowHide({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} tabIndex={-1} className="text-[12.5px] font-semibold text-neutral-500 hover:text-neutral-800">
      {shown ? "Hide" : "Show"}
    </button>
  );
}
