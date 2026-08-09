import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "@/components/icons";

/**
 * The public marketing page — what a signed-out visitor to consl.ai sees (middleware redirects
 * "/" here without a session). Deliberately hard-coded to a LIGHT palette rather than the app's
 * theme tokens: the product screenshots are light, and a marketing page should look identical to
 * every visitor regardless of their OS theme.
 */

export const metadata: Metadata = {
  title: "consl — inventory, production & true landed cost for ecommerce operators",
  description:
    "consl connects purchases, production runs and sales channels into one live view: the true landed cost of every unit, and restock alerts before you run out. Amazon, Shopify and TikTok Shop.",
  openGraph: {
    title: "consl — the console for ecommerce operators",
    description: "True landed cost per unit, production tracking and multichannel restocking in one place.",
    images: ["/marketing/dashboard.jpg"],
  },
};

const CTA_PRIMARY =
  "inline-flex items-center justify-center rounded-xl bg-violet-600 px-5 py-3 text-[14.5px] font-semibold text-white shadow-sm transition-colors hover:bg-violet-700";
const CTA_SECONDARY =
  "inline-flex items-center justify-center rounded-xl border border-neutral-300 bg-white px-5 py-3 text-[14.5px] font-semibold text-neutral-800 transition-colors hover:border-neutral-400";

function Wordmark({ size = 26 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/consl-mark.png" alt="" style={{ height: size, width: size }} className="object-contain" />
      <span className="text-[19px] font-bold tracking-tight text-neutral-900">consl</span>
    </span>
  );
}

/** A product screenshot dressed as a floating browser window. */
function Shot({ src, alt, priority = false }: { src: string; alt: string; priority?: boolean }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_24px_70px_-28px_rgba(76,29,149,0.35)]">
      <div className="flex items-center gap-1.5 border-b border-neutral-200 bg-neutral-50 px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-neutral-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-neutral-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-neutral-300" />
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} loading={priority ? "eager" : "lazy"} className="block w-full" />
    </div>
  );
}

function PlatformTile({ img, label, note }: { img?: string; label: string; note?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-neutral-200 bg-white px-5 py-4">
      {img ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={img} alt="" className="h-9 w-9 rounded-lg border border-neutral-200 bg-white object-contain p-0.5" />
      ) : (
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-neutral-900 text-white">
          {/* simple note glyph for TikTok Shop until the platform mark ships */}
          <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="currentColor" aria-hidden>
            <path d="M14 3v10.6a3.6 3.6 0 1 1-2.4-3.4V6.2A6.4 6.4 0 1 0 16.4 12V8.1c1 .74 2.23 1.2 3.6 1.27V6.5A4.79 4.79 0 0 1 16.6 4.9 4.63 4.63 0 0 1 15.5 3H14Z" />
          </svg>
        </span>
      )}
      <div className="min-w-0">
        <div className="text-[13.5px] font-semibold text-neutral-900">{label}</div>
        {note && <div className="text-[11.5px] font-medium text-violet-700">{note}</div>}
      </div>
    </div>
  );
}

function Feature({
  eyebrow,
  title,
  body,
  bullets,
  shot,
  alt,
  flip = false,
}: {
  eyebrow: string;
  title: string;
  body: string;
  bullets: string[];
  shot: string;
  alt: string;
  flip?: boolean;
}) {
  return (
    <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
      <div className={flip ? "lg:order-2" : ""}>
        <div className="text-[12.5px] font-bold uppercase tracking-wider text-violet-700">{eyebrow}</div>
        <h3 className="mt-2 text-[28px] font-bold leading-tight tracking-tight text-neutral-900 sm:text-[32px]">{title}</h3>
        <p className="mt-3 text-[15.5px] leading-relaxed text-neutral-600">{body}</p>
        <ul className="mt-5 space-y-2.5">
          {bullets.map((b) => (
            <li key={b} className="flex items-start gap-2.5 text-[14px] text-neutral-800">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-700">
                <Check size={12} />
              </span>
              {b}
            </li>
          ))}
        </ul>
      </div>
      <div className={flip ? "lg:order-1" : ""}>
        <Shot src={shot} alt={alt} />
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white text-neutral-900" style={{ colorScheme: "light" }}>
      {/* ── Nav ─────────────────────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-neutral-200/80 bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link href="/home" aria-label="consl home">
            <Wordmark />
          </Link>
          <nav className="hidden items-center gap-7 text-[13.5px] font-medium text-neutral-600 sm:flex">
            <a href="#features" className="hover:text-neutral-900">Features</a>
            <a href="#integrations" className="hover:text-neutral-900">Integrations</a>
          </nav>
          <div className="flex items-center gap-2.5">
            <Link href="/sign-in" className="rounded-xl px-3.5 py-2 text-[13.5px] font-semibold text-neutral-700 hover:bg-neutral-100">
              Log in
            </Link>
            <Link href="/sign-up" className="rounded-xl bg-neutral-900 px-4 py-2 text-[13.5px] font-semibold text-white hover:bg-neutral-700">
              Get started
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ────────────────────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[560px]"
          style={{ background: "radial-gradient(60% 60% at 50% 0%, rgba(124,58,237,0.14) 0%, rgba(124,58,237,0.05) 45%, transparent 75%)" }}
        />
        <div className="relative mx-auto max-w-6xl px-5 pb-16 pt-16 text-center sm:pt-24">
          <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-3.5 py-1.5 text-[12.5px] font-semibold text-violet-800">
            Inventory · Production · True landed cost
          </div>
          <h1 className="mx-auto mt-5 max-w-3xl text-[40px] font-bold leading-[1.05] tracking-tight sm:text-[56px]">
            The console for ecommerce operators.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-[16.5px] leading-relaxed text-neutral-600 sm:text-[18px]">
            consl connects your purchases, production runs and sales channels into one live view — the{" "}
            <span className="font-semibold text-neutral-900">true landed cost of every unit</span>, and restock alerts long
            before you run out.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/sign-up" className={CTA_PRIMARY}>Get started</Link>
            <a href="mailto:admin@consl.ai" className={CTA_SECONDARY}>Talk to us</a>
          </div>
          <p className="mt-4 text-[12.5px] text-neutral-500">Built for brands that make physical products and sell them everywhere.</p>

          <div className="relative mx-auto mt-14 max-w-5xl">
            <Shot src="/marketing/dashboard.jpg" alt="consl dashboard — live inventory value, lead times and reorder alerts" priority />
          </div>
        </div>
      </section>

      {/* ── Integrations strip ──────────────────────────────────────────────────────────── */}
      <section id="integrations" className="border-y border-neutral-200 bg-neutral-50/60">
        <div className="mx-auto max-w-6xl px-5 py-12">
          <div className="text-center text-[12.5px] font-bold uppercase tracking-wider text-neutral-500">
            Connects to where you sell
          </div>
          <div className="mx-auto mt-6 grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-4">
            <PlatformTile img="/integrations/amazon-fba.png" label="Amazon FBA" />
            <PlatformTile img="/integrations/amazon-awd.png" label="Amazon AWD" />
            <PlatformTile img="/integrations/shopify.png" label="Shopify" />
            <PlatformTile label="TikTok Shop" note="Coming soon" />
          </div>
          <p className="mx-auto mt-6 max-w-2xl text-center text-[13.5px] leading-relaxed text-neutral-600">
            Channel stock becomes real facilities in your workspace — including Amazon MCF awareness, so inventory mirrored
            into Shopify is never counted twice.
          </p>
        </div>
      </section>

      {/* ── Features ────────────────────────────────────────────────────────────────────── */}
      <section id="features" className="mx-auto max-w-6xl space-y-24 px-5 py-20 sm:space-y-28 sm:py-24">
        <Feature
          eyebrow="Cost engine"
          title="Know your real cost — to the cent."
          body="Every production lot is costed from its actual inputs: raw materials consumed oldest-stock-first, plus the deposits, final payments, certifications and fees you assign to it. The result is a landed cost per unit, per batch — not a spreadsheet estimate."
          bullets={[
            "FIFO raw-material costing across facilities",
            "Per-SKU batch costs, statuses and payment tracking",
            "Invoices, COAs and BOLs attached to the lot they belong to",
          ]}
          shot="/marketing/lots.jpg"
          alt="Production lots with live FIFO-costed COG per batch"
        />
        <Feature
          flip
          eyebrow="Restock autopilot"
          title="Never sell out. Never over-order."
          body="consl reads your sales velocity, projects months of cover for every SKU, and tells you when to order, when to ship stock you already own, and when a lot needs expediting — before the stockout, not after."
          bullets={[
            "Sales-velocity forecasting with configurable windows",
            "Order and ship-by recommendations per SKU",
            "Out-of-stock and expedite alerts on the dashboard",
          ]}
          shot="/marketing/reorder.jpg"
          alt="Reorder view — per-SKU cover, statuses and recommended actions"
        />
        <Feature
          eyebrow="Multichannel"
          title="Every unit, everywhere."
          body="Co-packers, your own warehouses, 3PLs — and the channels themselves. Connecting Amazon or Shopify creates managed facilities for FBA, AWD and each store location, so channel stock has a real place in your operation instead of living in a report."
          bullets={[
            "Channel facilities created automatically on connect",
            "Amazon MCF-aware: mirrored stock never double-counts",
            "Stock movements between any of your locations",
          ]}
          shot="/marketing/facilities.jpg"
          alt="Facilities — co-packers, warehouses and connected sales channels"
        />
        <Feature
          flip
          eyebrow="Production & materials"
          title="Production without the spreadsheet maze."
          body="Raw materials tracked per facility with low-stock alerts, bills of materials that carry forward from one run to the next, and per-SKU batch numbers, expiry dates and production status on every lot."
          bullets={[
            "Bills of materials inherited from each SKU's last run",
            "Batch numbers and expiry dates per SKU",
            "Low-stock alerts on the materials you make things from",
          ]}
          shot="/marketing/inventory.jpg"
          alt="Inventory — raw materials, work in production and finished goods"
        />
      </section>

      {/* ── CTA band ────────────────────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-5 pb-20 sm:pb-24">
        <div className="relative overflow-hidden rounded-3xl bg-neutral-950 px-6 py-14 text-center sm:px-12">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{ background: "radial-gradient(50% 80% at 50% 100%, rgba(124,58,237,0.35) 0%, transparent 70%)" }}
          />
          <h2 className="relative text-[30px] font-bold tracking-tight text-white sm:text-[36px]">Stop guessing your margins.</h2>
          <p className="relative mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-neutral-300">
            consl is in early access with operators who make and sell physical products. Tell us about your brand and
            we&apos;ll get you set up.
          </p>
          <div className="relative mt-7 flex flex-wrap items-center justify-center gap-3">
            <a href="mailto:admin@consl.ai" className={CTA_PRIMARY}>Get early access</a>
            <Link
              href="/sign-in"
              className="inline-flex items-center justify-center rounded-xl border border-white/25 px-5 py-3 text-[14.5px] font-semibold text-white hover:bg-white/10"
            >
              Log in
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────────────────────── */}
      <footer className="border-t border-neutral-200">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 text-[13px] text-neutral-500 sm:flex-row">
          <div className="flex items-center gap-3">
            <Wordmark size={20} />
            <span className="hidden text-neutral-300 sm:inline">·</span>
            <span className="hidden sm:inline">the console for ecommerce operators</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1">
            <a href="mailto:admin@consl.ai" className="hover:text-neutral-800">admin@consl.ai</a>
            <Link href="/privacy" className="hover:text-neutral-800">Privacy</Link>
            <Link href="/terms" className="hover:text-neutral-800">Terms</Link>
            <span>© {new Date().getFullYear()} Bluesteam LLC</span>
          </div>
        </div>
      </footer>

    </div>
  );
}
