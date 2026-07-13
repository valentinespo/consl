"use client";

import { useState } from "react";
import { X, FileText, ExternalLink } from "lucide-react";

/** A clickable trigger that opens an in-app modal preview (iframe) of a PDF or image — no re-download. */
export function DocPreview({
  url,
  name,
  children,
  className,
}: {
  url: string;
  name?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className={className ?? "inline-flex items-center gap-1 text-[12px] font-medium text-positive hover:underline"}
      >
        {children ?? (
          <>
            <FileText size={13} /> Preview
          </>
        )}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/60 p-4 sm:p-8" onClick={() => setOpen(false)}>
          <div
            className="mx-auto flex h-full w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-surface shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <div className="flex min-w-0 items-center gap-2 text-[13px] font-medium text-ink-soft">
                <FileText size={15} className="shrink-0" />
                <span className="truncate">{name ?? "Document"}</span>
              </div>
              <div className="flex items-center gap-1">
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink"
                  title="Open in new tab"
                >
                  <ExternalLink size={15} />
                </a>
                <button onClick={() => setOpen(false)} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink" title="Close">
                  <X size={16} />
                </button>
              </div>
            </div>
            <iframe src={url} title={name ?? "Document"} className="h-full w-full flex-1 bg-white" />
          </div>
        </div>
      )}
    </>
  );
}
