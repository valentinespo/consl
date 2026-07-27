"use client";

import { useMemo, useState } from "react";
import { X, Check } from "@/components/icons";
import {
  RESOURCES,
  RESOURCE_KEYS,
  actionsOf,
  MEMBER_DEFAULT,
  fullPermissions,
  type Action,
  type Permissions,
  type Resource,
} from "@/lib/permissions";
import { updateMemberPermissions } from "@/app/team/actions";

const ALL_ACTIONS: Action[] = ["view", "create", "edit", "delete", "manage"];
const ACTION_LABEL: Record<Action, string> = {
  view: "View",
  create: "Create",
  edit: "Edit",
  delete: "Delete",
  manage: "Manage",
};

/** Which action columns any resource actually uses — keeps the grid from carrying empty columns. */
function usedActions(): Action[] {
  const used = new Set<Action>();
  for (const r of RESOURCE_KEYS) for (const a of actionsOf(r)) used.add(a);
  return ALL_ACTIONS.filter((a) => used.has(a));
}

function toSets(p: Permissions): Record<string, Set<Action>> {
  const out: Record<string, Set<Action>> = {};
  for (const r of RESOURCE_KEYS) out[r] = new Set(p[r] ?? []);
  return out;
}

function toPermissions(sets: Record<string, Set<Action>>): Permissions {
  const out: Permissions = {};
  for (const r of RESOURCE_KEYS) {
    const arr = actionsOf(r).filter((a) => sets[r]?.has(a));
    if (arr.length) out[r] = arr as Action[];
  }
  return out;
}

/**
 * Owner-facing editor for one member's access. A modal grid of resource rows × action columns.
 * View gates a section: turning View off clears the row's other actions, and turning any write
 * action on implies View — so a member can never hold "edit but can't see it".
 */
export function PermissionsEditor({
  who,
  clerkUserId,
  initial,
  onClose,
  onSaved,
}: {
  who: string;
  clerkUserId: string;
  initial: Permissions;
  onClose: () => void;
  onSaved: () => void;
}) {
  const cols = useMemo(usedActions, []);
  const [sets, setSets] = useState<Record<string, Set<Action>>>(() => toSets(initial));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function replace(next: Record<string, Set<Action>>) {
    setSets({ ...next });
  }

  function toggle(resource: Resource, action: Action) {
    const next = { ...sets, [resource]: new Set(sets[resource]) };
    const row = next[resource];
    const on = !row.has(action);
    if (on) {
      row.add(action);
      if (action !== "view") row.add("view"); // any grant implies being able to see it
    } else {
      row.delete(action);
      if (action === "view") row.clear(); // can't see it → can't do anything with it
    }
    replace(next);
  }

  function setRow(resource: Resource, mode: "all" | "view" | "none") {
    const next = { ...sets };
    if (mode === "none") next[resource] = new Set();
    else if (mode === "view") next[resource] = new Set<Action>(actionsOf(resource).includes("view") ? ["view"] : []);
    else next[resource] = new Set(actionsOf(resource));
    replace(next);
  }

  function applyPreset(p: Permissions) {
    replace(toSets(p));
  }

  async function save() {
    setSaving(true);
    setError(null);
    const res = await updateMemberPermissions(clerkUserId, toPermissions(sets));
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onSaved();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="max-h-[88vh] w-full max-w-2xl overflow-auto rounded-2xl border border-border bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-line bg-surface px-5 py-4">
          <div>
            <div className="text-[14px] font-semibold text-ink">Access for {who}</div>
            <div className="text-[11.5px] text-muted">Choose exactly what they can see and change.</div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-line px-5 py-3">
          <button onClick={() => applyPreset(fullPermissions())} className={presetCls}>
            Full access
          </button>
          <button onClick={() => applyPreset(MEMBER_DEFAULT)} className={presetCls}>
            Standard member
          </button>
          <button onClick={() => applyPreset({})} className={presetCls}>
            No access
          </button>
        </div>

        <div className="px-2 py-1">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="text-muted">
                <th className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide">Section</th>
                {cols.map((a) => (
                  <th key={a} className="px-2 py-2 text-center text-[11px] font-medium uppercase tracking-wide">
                    {ACTION_LABEL[a]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {RESOURCE_KEYS.map((r) => {
                const allowed = actionsOf(r);
                const row = sets[r] ?? new Set<Action>();
                return (
                  <tr key={r} className="border-t border-line/60">
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-ink">{RESOURCES[r].label}</div>
                      <div className="mt-0.5 flex gap-2 text-[10.5px] text-muted">
                        <button onClick={() => setRow(r, "all")} className="hover:text-ink-soft hover:underline">
                          All
                        </button>
                        {allowed.includes("view") && (
                          <button onClick={() => setRow(r, "view")} className="hover:text-ink-soft hover:underline">
                            View only
                          </button>
                        )}
                        <button onClick={() => setRow(r, "none")} className="hover:text-ink-soft hover:underline">
                          None
                        </button>
                      </div>
                    </td>
                    {cols.map((a) => {
                      const supported = allowed.includes(a);
                      const on = row.has(a);
                      return (
                        <td key={a} className="px-2 py-2.5 text-center">
                          {supported ? (
                            <button
                              onClick={() => toggle(r, a)}
                              role="checkbox"
                              aria-checked={on}
                              aria-label={`${ACTION_LABEL[a]} ${RESOURCES[r].label}`}
                              className={`inline-flex h-5 w-5 items-center justify-center rounded-[6px] border transition-colors ${
                                on
                                  ? "border-accent-strong bg-accent-strong text-white"
                                  : "border-border bg-surface hover:border-accent-strong/60"
                              }`}
                            >
                              {on && <Check size={13} />}
                            </button>
                          ) : (
                            <span className="text-line">–</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {error && <div className="px-5 pb-1 text-[12px] text-negative">{error}</div>}

        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-line bg-surface px-5 py-3">
          <button onClick={onClose} className="rounded-lg border border-border px-3 py-2 text-[13px] text-ink-soft hover:bg-surface-2">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-bg hover:opacity-90 disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save access"}
          </button>
        </div>
      </div>
    </div>
  );
}

const presetCls =
  "rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12px] text-ink-soft hover:bg-surface-2";
