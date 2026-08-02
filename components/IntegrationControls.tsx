"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { disconnectIntegration } from "@/app/settings/integrations/actions";
import type { Provider } from "@/lib/integrations";

/** Connect (link to the OAuth start route) / Disconnect (two-step, server action) for one provider. */
export function IntegrationControls({
  provider,
  connected,
  canConnect,
}: {
  provider: Provider;
  connected: boolean;
  canConnect: boolean;
}) {
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const router = useRouter();

  if (connected) {
    return confirm ? (
      <span className="inline-flex items-center gap-1.5">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              await disconnectIntegration(provider);
              setConfirm(false);
              router.refresh();
            })
          }
          className="rounded-lg bg-negative px-3 py-2 text-[12.5px] font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Disconnecting…" : "Confirm disconnect"}
        </button>
        <button type="button" onClick={() => setConfirm(false)} className="text-[12.5px] text-muted hover:text-ink-soft">
          Cancel
        </button>
      </span>
    ) : (
      <button
        type="button"
        onClick={() => setConfirm(true)}
        className="rounded-lg border border-border bg-surface px-3.5 py-2 text-[13px] font-medium text-ink-soft hover:border-negative hover:text-negative"
      >
        Disconnect
      </button>
    );
  }

  if (canConnect) {
    return (
      <a
        href={`/api/integrations/${provider}/connect`}
        className="rounded-lg bg-accent-strong px-3.5 py-2 text-[13px] font-medium text-white hover:opacity-90"
      >
        Connect
      </a>
    );
  }

  return (
    <button
      disabled
      title="Not available yet"
      className="rounded-lg border border-border bg-surface px-3.5 py-2 text-[13px] font-medium text-ink-soft opacity-50"
    >
      Connect
    </button>
  );
}
