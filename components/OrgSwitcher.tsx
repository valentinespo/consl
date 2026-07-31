"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, Plus, Building2Outline as Building2 } from "@/components/icons";
import type { MyOrg } from "@/lib/orgs";
import { switchOrg } from "@/app/org/actions";
import { useExitAnimation } from "@/components/animate";

/** A company's own square mark, falling back to a neutral icon when it hasn't uploaded one. */
function OrgMark({ org, size }: { org: MyOrg | null; size: number }) {
  if (org?.iconUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={org.iconUrl}
        alt=""
        style={{ width: size, height: size }}
        className="shrink-0 rounded-md border border-border object-contain"
      />
    );
  }
  return (
    <span
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent"
    >
      <Building2 size={Math.round(size * 0.55)} />
    </span>
  );
}

/** Which company you're working in. A person can belong to several — their own businesses, or a
 *  client's they were invited into — so this is a picker, not a label.
 *  `variant="header"` renders the compact trigger that sits beside the iso mark in the top strip;
 *  the default fills the sidebar (still used in the mobile drawer). */
export function OrgSwitcher({
  orgs,
  onNavigate,
  variant = "sidebar",
}: {
  orgs: MyOrg[];
  onNavigate?: () => void;
  variant?: "sidebar" | "header";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const menu = useExitAnimation(open, 170);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  const current = orgs.find((o) => o.active) ?? orgs[0] ?? null;

  // Close on an outside click or Escape — a menu that traps you is worse than no menu.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function choose(orgId: string) {
    if (orgId === current?.id) {
      setOpen(false);
      return;
    }
    setError(null);
    setBusy(orgId);
    const res = await switchOrg(orgId);
    if (!res.ok) {
      setError(res.error);
      setBusy(null);
      return;
    }
    // Full reload: every server component on the page belongs to the previous company.
    window.location.href = "/";
  }

  const header = variant === "header";
  return (
    <div ref={wrap} className={header ? "relative" : "relative px-3"}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={
          header
            ? "flex max-w-[220px] items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface"
            : "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-2"
        }
      >
        <OrgMark org={current} size={header ? 22 : 24} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
          {current?.name ?? "No company"}
        </span>
        <ChevronsUpDown size={14} className="shrink-0 text-muted" />
      </button>

      {menu.mounted && (
        <div
          role="menu"
          className={`${menu.closing ? "org-pop-out" : "org-pop"} absolute top-full z-50 mt-1 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-xl ${
            header ? "left-0 w-72" : "inset-x-3"
          }`}
        >
          {orgs.length > 1 && (
            <div className="px-3 pb-1 pt-1.5 text-[10.5px] font-medium uppercase tracking-wide text-muted">
              Your companies
            </div>
          )}
          {orgs.map((o) => (
            <button
              key={o.id}
              role="menuitem"
              onClick={() => choose(o.id)}
              disabled={busy !== null}
              className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-2 disabled:opacity-60"
            >
              <OrgMark org={o} size={22} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-ink">{o.name}</span>
                <span className="block text-[11px] text-muted">{o.role === "owner" ? "Owner" : "Member"}</span>
              </span>
              {busy === o.id ? (
                <span className="text-[11px] text-muted">Switching…</span>
              ) : o.active ? (
                <Check size={14} className="shrink-0 text-accent" />
              ) : null}
            </button>
          ))}

          <div className="my-1 border-t border-line" />

          <a
            href="/welcome?new=1"
            onClick={onNavigate}
            role="menuitem"
            className="flex items-center gap-2 px-3 py-2 text-[13px] text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <Plus size={14} className="shrink-0 text-muted" />
            Create new company
          </a>
        </div>
      )}

      {error && <div className="px-2 pt-1 text-[11px] text-negative">{error}</div>}
    </div>
  );
}
