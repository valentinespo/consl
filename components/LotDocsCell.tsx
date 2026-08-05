"use client";

import { useState } from "react";
import { FileText, ExternalLink, X } from "@/components/icons";

export type LotDoc = { id: string; label: string | null; fileUrl: string; fileName: string | null };

/** The Documents cell on the Production Lots table: the lot's uploaded documents grouped by label
 *  with a count (COA, COA ×2, BOL ×6…), each a small purple link that previews that group's files
 *  in a modal. Purely a view of what's attached — no expected/missing state. */
export function LotDocsCell({ documents }: { documents: LotDoc[] }) {
  const [preview, setPreview] = useState<{ label: string; docs: LotDoc[] } | null>(null);

  if (documents.length === 0) return <span className="text-[11px] text-muted">None</span>;

  // Group by label, preserving first-seen order.
  const groups: { label: string; docs: LotDoc[] }[] = [];
  const index = new Map<string, number>();
  for (const d of documents) {
    const label = (d.label ?? "").trim() || "Doc";
    let i = index.get(label.toLowerCase());
    if (i == null) {
      i = groups.length;
      index.set(label.toLowerCase(), i);
      groups.push({ label, docs: [] });
    }
    groups[i].docs.push(d);
  }

  return (
    <>
      {/* Always stacked vertically — one document group per line, never side by side. */}
      <div className="flex flex-col items-start gap-1">
        {groups.map((g) => (
          <button
            key={g.label}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setPreview(g);
            }}
            className="inline-flex items-center gap-1 whitespace-nowrap text-[11.5px] font-medium text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
            title={`Preview ${g.docs.length} ${g.label} document${g.docs.length > 1 ? "s" : ""}`}
          >
            <FileText size={12} className="shrink-0" />
            {g.label}
            {g.docs.length > 1 && <span className="tabular">×{g.docs.length}</span>}
          </button>
        ))}
      </div>

      {/* Keyed by label so switching groups resets the active tab instead of reusing stale state. */}
      {preview && <DocsModal key={preview.label} label={preview.label} docs={preview.docs} onClose={() => setPreview(null)} />}
    </>
  );
}

/** Modal previewing one label group's documents, with a tab per file when there's more than one. */
function DocsModal({ label, docs, onClose }: { label: string; docs: LotDoc[]; onClose: () => void }) {
  const [active, setActive] = useState(0);
  const doc = docs[Math.min(active, docs.length - 1)];
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/60 p-4 sm:p-8" onClick={onClose}>
      <div className="mx-auto flex h-full w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-[13px] font-medium text-ink-soft">
            <FileText size={15} className="shrink-0" />
            {docs.length === 1 ? (
              <span className="truncate">{doc.fileName ?? label}</span>
            ) : (
              docs.map((d, i) => (
                <button
                  key={d.id}
                  onClick={() => setActive(i)}
                  className={`rounded-md px-2 py-0.5 text-[12px] ${i === active ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2"}`}
                >
                  {label} {i + 1}
                </button>
              ))
            )}
          </div>
          <div className="flex items-center gap-1">
            <a href={doc.fileUrl} target="_blank" rel="noreferrer" className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink" title="Open in new tab">
              <ExternalLink size={15} />
            </a>
            <button onClick={onClose} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink" title="Close">
              <X size={16} />
            </button>
          </div>
        </div>
        {/* Keyed per document: React reuses the iframe element across tab switches, and a mutated
            src doesn't reliably navigate it — the same file kept showing on every tab. A fresh
            mount per doc always loads the right file. */}
        <iframe key={doc.id} src={doc.fileUrl} title={doc.fileName ?? label} className="h-full w-full flex-1 bg-white" />
      </div>
    </div>
  );
}
