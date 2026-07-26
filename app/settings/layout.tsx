import Link from "next/link";
import { SettingsTabs } from "@/components/SettingsTabs";

/** Shared chrome for every Settings section: one title, one tab strip, one place to come back from. */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Link href="/" className="mb-3 inline-block text-[12.5px] font-medium text-muted hover:text-ink-soft">
        ← Dashboard
      </Link>
      <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-border pb-4">
        <h1 className="text-[26px] font-semibold tracking-tight text-ink">Settings</h1>
        <SettingsTabs />
      </div>
      {children}
    </>
  );
}
