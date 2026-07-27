import type { LucideIcon } from "@/components/icons";

/** Shown wherever a list has no rows yet, so a brand-new account never faces a blank screen.
 *  `children` is the primary call-to-action. */
export function EmptyState({
  icon: Icon,
  title,
  body,
  children,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-border bg-surface-2/40 px-6 py-10 text-center">
      <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
        <Icon size={20} />
      </span>
      <div className="text-[14px] font-semibold text-ink">{title}</div>
      <p className="mt-1 max-w-sm text-[12.5px] leading-relaxed text-muted">{body}</p>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
