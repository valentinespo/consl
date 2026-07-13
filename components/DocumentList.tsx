"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Upload, Paperclip } from "lucide-react";
import { DocPreview } from "@/components/DocPreview";
import { uploadDocument, deleteDocument, type DocParent } from "@/app/documents/actions";

export type Doc = { id: string; label: string | null; fileUrl: string; fileName: string | null };

/** Multiple-document attachment list for a lot, transaction invoice, or purchase invoice. */
export function DocumentList({
  parent,
  parentId,
  documents,
  quickLabels = [],
  showLabelField = false,
  emptyText = "No documents yet.",
}: {
  parent: DocParent;
  parentId: string;
  documents: Doc[];
  quickLabels?: string[];
  showLabelField?: boolean;
  emptyText?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    const fd = new FormData();
    fd.set("parent", parent);
    fd.set("parentId", parentId);
    fd.set("label", label.trim());
    fd.set("file", file);
    start(async () => {
      const r = await uploadDocument(fd);
      if (r && !r.ok) setError(r.error);
      else setLabel("");
      router.refresh();
    });
    e.target.value = "";
  }

  function del(id: string) {
    start(async () => {
      await deleteDocument(id);
      router.refresh();
    });
  }

  return (
    <div>
      <div className="space-y-1.5">
        {documents.map((d) => (
          <div key={d.id} className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5">
            {d.label ? (
              <span className="shrink-0 rounded-md bg-accent-soft px-1.5 py-0.5 text-[10.5px] font-semibold uppercase text-ink">{d.label}</span>
            ) : (
              <Paperclip size={13} className="shrink-0 text-muted" />
            )}
            <span className="min-w-0 truncate text-[12.5px] text-ink-soft" title={d.fileName ?? ""}>
              {d.fileName ?? "document"}
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-2.5">
              <DocPreview url={d.fileUrl} name={d.fileName ?? d.label ?? "Document"} />
              <button type="button" onClick={() => del(d.id)} disabled={pending} className="text-muted hover:text-negative disabled:opacity-50" title="Delete document">
                <Trash2 size={13} />
              </button>
            </span>
          </div>
        ))}
        {documents.length === 0 && <div className="text-[12px] text-muted">{emptyText}</div>}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {showLabelField && (
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label"
            className="h-8 w-24 rounded-lg border border-border bg-surface px-2 text-[12.5px] text-ink outline-none focus:border-accent-strong"
          />
        )}
        {quickLabels.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => setLabel(q)}
            className={`rounded-md border px-1.5 py-1 text-[11px] font-medium ${label === q ? "border-accent-strong bg-accent-soft text-ink" : "border-border text-muted hover:text-ink-soft"}`}
          >
            {q}
          </button>
        ))}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12px] font-medium text-ink-soft hover:border-accent-strong disabled:opacity-50"
        >
          <Upload size={13} /> {pending ? "Uploading…" : "Upload"}
        </button>
        <input ref={inputRef} type="file" accept="application/pdf,image/*" hidden onChange={onPick} />
        {error && <span className="text-[11px] text-negative">{error}</span>}
      </div>
    </div>
  );
}
