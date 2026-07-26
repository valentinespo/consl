"use client";

import { useState } from "react";

/**
 * The product's own mark — not the customer's. Each company's logo appears on their documents;
 * this is the app they're all signed in to.
 *
 * Drop the artwork at `public/brand/app-logo.svg` (or .png and change the path) and it's used
 * automatically. Until then, the wordmark renders as type so the sidebar is never broken or empty.
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
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand/app-logo.svg"
      alt="SellerOps"
      onError={() => setMissing(true)}
      className={`h-[20px] w-auto object-contain ${className}`}
    />
  );
}
