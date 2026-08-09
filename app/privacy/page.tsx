import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacy Policy — consl" };

/** Short, honest and current. Update it when the product's data practices actually change. */
export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white text-neutral-900" style={{ colorScheme: "light" }}>
      <div className="mx-auto max-w-2xl px-5 py-16">
        <Link href="/home" className="text-[13px] font-medium text-violet-700 hover:underline">← consl.ai</Link>
        <h1 className="mt-4 text-[32px] font-bold tracking-tight">Privacy Policy</h1>
        <p className="mt-1 text-[13px] text-neutral-500">Last updated: August 2026</p>

        <div className="mt-8 space-y-6 text-[14.5px] leading-relaxed text-neutral-700">
          <p>
            consl (operated by Bluesteam LLC) is an inventory, production and cost-accounting tool for ecommerce
            businesses. This policy describes what we collect and how we use it.
          </p>

          <section>
            <h2 className="mb-1.5 text-[17px] font-semibold text-neutral-900">What we collect</h2>
            <p>
              Account details (name, email) for sign-in; and the business data you create or connect — products,
              purchases, production lots, suppliers, facilities, and inventory, order and listing data pulled from sales
              platforms you explicitly authorize (such as Amazon, Shopify or TikTok Shop) through their official APIs.
            </p>
          </section>

          <section>
            <h2 className="mb-1.5 text-[17px] font-semibold text-neutral-900">How we use it</h2>
            <p>
              Solely to provide the service to you: computing costs, tracking inventory and generating restock
              recommendations for your own workspace. We do not sell your data, share it with third parties for their own
              purposes, or use it for advertising. Order data from connected platforms is aggregated into per-product
              daily unit counts; we do not use your customers&apos; personal information.
            </p>
          </section>

          <section>
            <h2 className="mb-1.5 text-[17px] font-semibold text-neutral-900">Storage & security</h2>
            <p>
              Data is stored on managed cloud infrastructure in the United States. Platform access tokens are encrypted
              at rest, connections use TLS, and access to your workspace is limited to the people you invite.
            </p>
          </section>

          <section>
            <h2 className="mb-1.5 text-[17px] font-semibold text-neutral-900">Your control</h2>
            <p>
              You can disconnect a sales platform at any time, which revokes our access to it. To export or delete your
              account and its data, email us and we&apos;ll complete it promptly.
            </p>
          </section>

          <section>
            <h2 className="mb-1.5 text-[17px] font-semibold text-neutral-900">Contact</h2>
            <p>
              Bluesteam LLC ·{" "}
              <a href="mailto:admin@consl.ai" className="font-medium text-violet-700 hover:underline">admin@consl.ai</a>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
