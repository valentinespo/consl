import { notFound } from "next/navigation";
import { requireView } from "@/lib/membership";

export const dynamic = "force-dynamic";

// The PO "View" link opens this thin wrapper instead of the raw PDF: an app page carries the
// app's favicon and a readable tab title, where a bare PDF tab falls back to whatever icon the
// browser has cached for the origin (often a stale one).
const SAFE = /^[\w.() -]+\.pdf$/i;

export async function generateMetadata({ params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const name = decodeURIComponent(file).replace(/-\d+\.pdf$/i, "").replace(/\.pdf$/i, "");
  return { title: name };
}

export default async function PoPreviewPage({ params }: { params: Promise<{ file: string }> }) {
  await requireView("purchaseOrders");
  const { file } = await params;
  const name = decodeURIComponent(file);
  if (!SAFE.test(name)) notFound();
  return (
    <iframe
      src={`/media/po/${encodeURIComponent(name)}`}
      title={name}
      className="h-[calc(100dvh-8rem)] w-full rounded-[var(--radius-card)] border border-border bg-surface"
    />
  );
}
