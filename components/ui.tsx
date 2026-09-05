import Link from "next/link";
import { skuColor } from "@/lib/format";

export function Card({
  children,
  className = "",
  padded = true,
}: {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={`rounded-[var(--radius-card)] border border-border bg-surface ${padded ? "p-5" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  accent = false,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-[var(--radius-card)] border p-5 ${
        accent ? "border-accent-strong bg-accent-soft" : "border-border bg-surface"
      }`}
    >
      <div className="text-[13px] font-medium text-muted">{label}</div>
      <div className="mt-2 text-[26px] font-medium tracking-tight text-ink tabular">{value}</div>
      {sub && <div className="mt-1 text-[12px] text-muted">{sub}</div>}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-[15px] font-medium text-ink-soft">{children}</h2>
      {action}
    </div>
  );
}

const PILL: Record<string, string> = {
  IN_PRODUCTION: "pill-chart",
  FINISHED: "pill-green",
  PAID: "pill-green",
  DUE: "pill-amber",
  TEA: "pill-neutral",
  OTHER: "pill-neutral",
  NOT_APPLICABLE: "pill-red",
  DRAFT: "pill-neutral",
  SENT: "pill-green",
};

export function Pill({ kind, children }: { kind?: keyof typeof PILL | string; children: React.ReactNode }) {
  const cls = (kind && PILL[kind]) || "pill-neutral";
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${cls}`}>
      {children}
    </span>
  );
}

export function SkuAvatar({ code, size = 36, imageUrl }: { code: string; size?: number; imageUrl?: string | null }) {
  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        alt={code}
        title={code}
        className="inline-block shrink-0 rounded-[10px] border border-border object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  const { bg, fg } = skuColor(code);
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-[10px] font-semibold"
      style={{ width: size, height: size, background: bg, color: fg, fontSize: size * 0.3 }}
      title={code}
    >
      {code}
    </span>
  );
}

export function SupplierAvatar({
  name,
  photoUrl,
  size = 22,
}: {
  name: string | null;
  photoUrl?: string | null;
  size?: number;
}) {
  if (!name) return <span className="text-muted">—</span>;
  const init = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  return (
    <span className="inline-flex items-center gap-2">
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt={name} style={{ width: size, height: size }} className="shrink-0 rounded-full border border-border object-cover" />
      ) : (
        <span
          style={{ width: size, height: size, fontSize: size * 0.4 }}
          className="inline-flex shrink-0 items-center justify-center rounded-full bg-accent-soft font-medium text-accent"
        >
          {init}
        </span>
      )}
      <span>{name}</span>
    </span>
  );
}

export function FacilityTag({ code }: { code: string }) {
  return (
    <span className="inline-flex items-center rounded-md border border-border bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-ink-soft">
      {code}
    </span>
  );
}

export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[24px] font-medium tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

export function LinkButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-bg transition-opacity hover:opacity-90"
    >
      {children}
    </Link>
  );
}
