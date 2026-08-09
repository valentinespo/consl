import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Terms of Service — consl" };

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white text-neutral-900" style={{ colorScheme: "light" }}>
      <div className="mx-auto max-w-2xl px-5 py-16">
        <Link href="/home" className="text-[13px] font-medium text-violet-700 hover:underline">← consl.ai</Link>
        <h1 className="mt-4 text-[32px] font-bold tracking-tight">Terms of Service</h1>
        <p className="mt-1 text-[13px] text-neutral-500">Last updated: August 2026</p>

        <div className="mt-8 space-y-6 text-[14.5px] leading-relaxed text-neutral-700">
          <p>
            consl is operated by Bluesteam LLC. By creating an account or using consl you agree to these terms.
          </p>

          <section>
            <h2 className="mb-1.5 text-[17px] font-semibold text-neutral-900">The service</h2>
            <p>
              consl provides inventory, production and cost-accounting tools for ecommerce businesses, including
              read-only integrations with sales platforms you choose to connect. consl is currently offered as an
              early-access service and is provided &quot;as is&quot;, without warranties of any kind.
            </p>
          </section>

          <section>
            <h2 className="mb-1.5 text-[17px] font-semibold text-neutral-900">Your data</h2>
            <p>
              Your business data remains yours. You grant us only the rights needed to operate the service for you, as
              described in our{" "}
              <Link href="/privacy" className="font-medium text-violet-700 hover:underline">Privacy Policy</Link>. You are
              responsible for maintaining the accuracy of the data you enter and for complying with the terms of any
              platform you connect.
            </p>
          </section>

          <section>
            <h2 className="mb-1.5 text-[17px] font-semibold text-neutral-900">Acceptable use</h2>
            <p>
              Don&apos;t misuse the service: no attempts to access other customers&apos; data, disrupt the platform, or
              use it for unlawful purposes. We may suspend accounts that do.
            </p>
          </section>

          <section>
            <h2 className="mb-1.5 text-[17px] font-semibold text-neutral-900">Liability</h2>
            <p>
              consl provides operational insights — figures such as costs, forecasts and recommendations are informational
              and business decisions made from them are your own. To the maximum extent permitted by law, Bluesteam LLC is
              not liable for indirect or consequential damages arising from use of the service.
            </p>
          </section>

          <section>
            <h2 className="mb-1.5 text-[17px] font-semibold text-neutral-900">Changes & contact</h2>
            <p>
              We may update these terms as the product evolves; continued use after an update constitutes acceptance.
              Questions:{" "}
              <a href="mailto:admin@consl.ai" className="font-medium text-violet-700 hover:underline">admin@consl.ai</a>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
