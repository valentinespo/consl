"use client";

import { useEffect } from "react";

/**
 * Route-level error boundary. Without one, any unhandled render or action error drops the user
 * on Next's default error screen with no way back into the app.
 *
 * Next redacts the message of errors thrown on the server in production and replaces it with a
 * digest, so there is nothing sensitive to show here — and nothing useful either. Show a plain
 * recovery screen and surface the digest, which is what correlates with the server log.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-lg flex-col items-start gap-4 py-20">
      <h1 className="text-[22px] font-semibold text-ink">Something went wrong</h1>
      <p className="text-[14px] text-muted">
        This page couldn&apos;t load. Your data is safe — nothing was changed. Try again, and if it keeps
        happening, reload the page.
      </p>
      {error.digest && (
        <p className="text-[12px] text-muted">
          Reference: <span className="tabular font-mono">{error.digest}</span>
        </p>
      )}
      <div className="flex gap-2">
        <button
          onClick={reset}
          className="rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-bg hover:opacity-90"
        >
          Try again
        </button>
        <a
          href="/"
          className="rounded-lg border border-border px-3.5 py-2 text-[13px] text-ink-soft hover:bg-surface-2"
        >
          Back to dashboard
        </a>
      </div>
    </div>
  );
}
