"use client";

import { useState } from "react";
import Image from "next/image";

/**
 * The product's own mark — not the customer's. Each company's logo appears on their documents;
 * this is the app they're all signed in to.
 *
 * Served through next/image so the 791×176 source is resized and re-encoded rather than shipping
 * 137 KB to render ~90px wide. Falls back to the wordmark as type if the file ever goes missing,
 * so the sidebar can't end up blank.
 */
export function AppLogo({ className = "" }: { className?: string }) {
  const [missing, setMissing] = useState(false);

  if (missing) {
    return (
      <span className={`text-[17px] font-bold leading-none tracking-tight text-[#0b63f6] ${className}`}>
        SellerOps
      </span>
    );
  }
  return (
    <Image
      src="/brand/app-logo.png"
      alt="SellerOps"
      width={791}
      height={176}
      // Renders ~90px wide; without this hint Next fetches a variant sized for the source instead.
      sizes="96px"
      priority
      onError={() => setMissing(true)}
      className={`h-[20px] w-auto ${className}`}
    />
  );
}
