import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Inter, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { getCurrentOrgId } from "@/lib/tenant";
import { currentUserId } from "@/lib/current-user";
import { getCurrentOrg } from "@/lib/org";
import { listMyOrgs } from "@/lib/orgs";

/** Pages that must stay reachable before you belong to a company. */
const NO_ORG_OK = ["/sign-in", "/sign-up", "/welcome", "/join"];

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

/** The tab shows the product, not the customer — one person can have several companies open in
 *  different tabs, and the app they're all in is SellerOps. */
export const metadata: Metadata = {
  title: "SellerOps",
  description: "Inventory, production and purchasing for ecommerce operators.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // A signed-in user who doesn't belong to a company yet gets sent to set one up. Without this
  // they'd land on the dashboard and every query would fail — there's no tenant to read from.
  const pathname = (await headers()).get("x-pathname") ?? "";
  if (!NO_ORG_OK.some((p) => pathname.startsWith(p)) && !(await getCurrentOrgId())) {
    if (await currentUserId()) redirect("/welcome");
  }
  const org = await getCurrentOrg().catch(() => null);
  const orgs = await listMyOrgs().catch(() => []);
  return (
    <ClerkProvider signInUrl="/sign-in" signUpUrl="/sign-up" afterSignOutUrl="/sign-in">
      <html lang="en" className={`${inter.variable} ${geistMono.variable} h-full antialiased`}>
        <body className="min-h-full">
          <AppShell
            orgName={org?.name ?? null}
            orgs={orgs}
            currencySymbol={org?.currencySymbol ?? "$"}
            locale={org?.locale ?? "en-US"}
            currencyCode={org?.currencyCode ?? "USD"}
          >
            {children}
          </AppShell>
        </body>
      </html>
    </ClerkProvider>
  );
}
