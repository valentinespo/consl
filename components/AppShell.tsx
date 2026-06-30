"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";

/** App chrome (sidebar + scroll container). Standalone pages like /login render bare. */
export function AppShell({ children, authEnabled = false }: { children: React.ReactNode; authEnabled?: boolean }) {
  const pathname = usePathname();
  if (pathname === "/login") return <>{children}</>;
  return (
    <div className="flex">
      <Sidebar authEnabled={authEnabled} />
      <main className="h-screen flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1180px] px-8 py-8">{children}</div>
      </main>
    </div>
  );
}
