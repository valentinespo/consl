"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Paperclip, X } from "lucide-react";
import { DocPreview } from "@/components/DocPreview";
import { setInvoiceDocument, removeInvoiceDocument } from "@/app/documents/actions";

/** Attach / preview / remove the single invoice PDF on a transaction or purchase invoice. */
export function InvoiceAttach({
  kind,
  id,
  url,
  readOnly = false,
}: {
  kind: "transaction" | "purchase";
  id: string;
  url: string | null;
  readOnly?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    const fd = new FormData();
    fd.set("kind", kind);
    fd.set("id", id);
    fd.set("file", file);
    start(async () => {
      const r = await setInvoiceDocument(fd);
      if (r && !r.ok) setError(r.error);
      router.refresh();
    });
    e.target.value = "";
  }

  function remove() {
    const fd = new FormData();
    fd.set("kind", kind);
    fd.set("id", id);
    start(async () => {
      await removeInvoiceDocument(fd);
      router.refresh();
    });
  }

  if (url) {
    return (
      <span className="inline-flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        <DocPreview url={url} name="Invoice">
          <span className="inline-flex items-center gap-1 text-[12px] font-medium text-positive hover:underline">
            <Paperclip size={12} /> Invoice
          </span>
        </DocPreview>
        {!readOnly && (
          <button type="button" onClick={remove} disabled={pending} title="Remove invoice" className="text-muted hover:text-negative disabled:opacity-50">
            <X size={13} />
          </button>
        )}
      </span>
    );
  }
  if (readOnly) return <span className="text-[12px] text-muted">No invoice</span>;
  return (
    <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={pending}
        className="inline-flex items-center gap-1 text-[12px] font-medium text-muted hover:text-ink-soft disabled:opacity-50"
      >
        <Paperclip size={12} /> {pending ? "Uploading…" : "Attach invoice"}
      </button>
      <input ref={inputRef} type="file" accept="application/pdf,image/*" hidden onChange={onPick} />
      {error && <span className="text-[10px] text-negative">{error}</span>}
    </span>
  );
}
