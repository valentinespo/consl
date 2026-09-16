import type { Metadata } from "next";
import { ApplyFlow } from "@/components/apply/ApplyFlow";

export const metadata: Metadata = {
  title: "Apply for early access — consl",
  description:
    "consl is opening early access to twenty brands that make and sell physical products: lifetime 50% off and a personal brand manager who sets the platform up with you, 1-1.",
};

// The Calendly link is read per request so it can be set or changed without a redeploy.
export const dynamic = "force-dynamic";

export default function ApplyPage() {
  return <ApplyFlow calendlyUrl={process.env.CALENDLY_URL?.trim() || null} />;
}
