"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";

export function useLtvLiveData(revision: string) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const lastRefresh = useRef(0);

  useEffect(() => {
    let stopped = false;
    let request: AbortController | null = null;

    async function check() {
      if (stopped || refreshing || request || document.hidden || !navigator.onLine) return;
      const controller = new AbortController();
      request = controller;
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch("/api/ltv/revision", { cache: "no-store", credentials: "same-origin", signal: controller.signal });
        if (stopped) return;
        if (response.status === 401 || response.status === 403) {
          stopped = true;
          startTransition(() => router.refresh());
          return;
        }
        if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return;
        const next: unknown = await response.json();
        if (stopped || !next || typeof next !== "object" || !("revision" in next) || typeof next.revision !== "string") return;
        if (next.revision !== revision && Date.now() - lastRefresh.current >= 5_000) {
          lastRefresh.current = Date.now();
          // Next merges new server data while retaining filter URLs, scroll and local drafts.
          startTransition(() => router.refresh());
        }
      } catch {
        // Keep the last report during a connection failure; the next check retries automatically.
      } finally {
        clearTimeout(timeout);
        request = null;
      }
    }

    const checkNow = () => { void check(); };
    const timer = setInterval(checkNow, 5_000);
    document.addEventListener("visibilitychange", checkNow);
    window.addEventListener("focus", checkNow);
    window.addEventListener("online", checkNow);
    checkNow();
    return () => {
      stopped = true;
      clearInterval(timer);
      request?.abort();
      document.removeEventListener("visibilitychange", checkNow);
      window.removeEventListener("focus", checkNow);
      window.removeEventListener("online", checkNow);
    };
  }, [revision, router, refreshing]);
}
