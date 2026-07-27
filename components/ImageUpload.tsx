"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, X } from "@/components/icons";
import { uploadEntityImage, removeEntityImage } from "@/app/catalog/actions";

export function ImageUpload({
  kind,
  id,
  url,
  fallback,
  size = 56,
  circle = false,
  editable = true,
}: {
  kind: "product" | "material" | "supplier";
  id: string;
  url: string | null;
  fallback: React.ReactNode;
  size?: number;
  circle?: boolean;
  editable?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const radius = circle ? "9999px" : "12px";

  // Read-only: just the image, no upload/remove affordances.
  if (!editable) {
    return (
      <div className="shrink-0 overflow-hidden border border-border" style={{ width: size, height: size, borderRadius: radius }}>
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">{fallback}</div>
        )}
      </div>
    );
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    const fd = new FormData();
    fd.set("kind", kind);
    fd.set("id", id);
    fd.set("file", file);
    start(async () => {
      const res = await uploadEntityImage(fd);
      if (res && !res.ok) setError(res.error ?? "Upload failed");
      router.refresh();
    });
    e.target.value = "";
  }

  function clear() {
    const fd = new FormData();
    fd.set("kind", kind);
    fd.set("id", id);
    start(async () => {
      await removeEntityImage(fd);
      router.refresh();
    });
  }

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        title="Upload image"
        className="group relative block overflow-hidden border border-border"
        style={{ width: size, height: size, borderRadius: radius }}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">{fallback}</div>
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
          <Camera size={size * 0.32} className="text-white" />
        </div>
        {pending && <div className="absolute inset-0 animate-pulse bg-black/20" />}
      </button>
      {url && !pending && (
        <button
          type="button"
          onClick={clear}
          title="Remove image"
          className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-surface text-muted shadow-sm hover:text-negative"
        >
          <X size={12} />
        </button>
      )}
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={onPick} />
      {error && <div className="absolute left-0 top-full mt-1 w-40 text-[10px] text-negative">{error}</div>}
    </div>
  );
}
