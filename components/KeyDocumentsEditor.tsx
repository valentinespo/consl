"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, SectionTitle } from "@/components/ui";
import { SaveBar, inputCls } from "@/components/FormKit";
import { Plus, X } from "@/components/icons";
import { saveKeyDocuments } from "@/app/settings/actions";

/** Edit the org's key-document labels (BOL, COA, …). Each becomes a presence pill on the lots
 *  table — purple when a matching-label document is attached to the lot, grey when missing. */
export function KeyDocumentsEditor({ initial }: { initial: string[] }) {
  const router = useRouter();
  const [labels, setLabels] = useState<string[]>(initial);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = JSON.stringify(labels) !== JSON.stringify(initial);

  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (labels.some((l) => l.toLowerCase() === v.toLowerCase())) {
      setError(`"${v}" is already in the list.`);
      return;
    }
    if (labels.length >= 8) {
      setError("Up to 8 key documents.");
      return;
    }
    setLabels([...labels, v]);
    setDraft("");
    setError(null);
  };

  async function save() {
    setPending(true);
    setError(null);
    try {
      const res = await saveKeyDocuments(labels);
      if (!res.ok) {
        setError(res.error ?? "Could not save.");
        return;
      }
      setLabels(res.labels);
      setSaved(true);
      router.refresh();
    } catch {
      setError("Couldn't reach the server — reload and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <SectionTitle>Key documents</SectionTitle>
      <p className="-mt-1 mb-4 text-[12.5px] text-muted">
        The documents every production lot should carry. Each shows as a pill on the Production Lots table —{" "}
        <span className="text-accent">purple</span>{" "}once a document with that label is uploaded to the lot, grey while it&apos;s missing.
      </p>

      <div className="flex flex-wrap gap-2">
        {labels.length === 0 && <span className="text-[12.5px] text-muted">None yet — add one below.</span>}
        {labels.map((l) => (
          <span key={l} className="inline-flex items-center gap-1.5 rounded-full border border-accent/25 bg-accent-soft px-2.5 py-1 text-[12px] font-medium text-accent">
            {l}
            <button type="button" onClick={() => setLabels(labels.filter((x) => x !== l))} className="text-accent/60 hover:text-accent" aria-label={`Remove ${l}`}>
              <X size={13} />
            </button>
          </span>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="e.g. BOL, COA, Packing list…"
          className={`${inputCls} max-w-xs`}
        />
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[13px] font-medium text-ink-soft hover:bg-surface-2"
        >
          <Plus size={14} /> Add
        </button>
      </div>

      <SaveBar dirty={dirty} pending={pending} error={error} saved={saved} onSave={save} onReset={() => { setLabels(initial); setError(null); }} />
    </Card>
  );
}
