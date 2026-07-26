import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { ensureMembership } from "@/lib/tenant";
import { getCurrentOrg } from "@/lib/org";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

/** Tab title follows the signed-in company, falling back before anyone has signed in. */
export async function generateMetadata(): Promise<Metadata> {
  const org = await getCurrentOrg().catch(() => null);
  const name = org?.name?.trim();
  return {
    title: name ? `${name} — Production & Inventory` : "Production & Inventory",
    description: "FIFO production lots, inventory and purchasing.",
  };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // First authenticated load links the user to their company.
  await ensureMembership();
  const org = await getCurrentOrg().catch(() => null);
  return (
    <ClerkProvider signInUrl="/sign-in" signUpUrl="/sign-up" afterSignOutUrl="/sign-in">
      <html lang="en" className={`${inter.variable} ${geistMono.variable} h-full antialiased`}>
        <body className="min-h-full">
          <AppShell
            orgName={org?.name ?? null}
            logoUrl={org?.logoUrl ?? null}
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
