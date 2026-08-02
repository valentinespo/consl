/**
 * The product's own mark — not the customer's. Each company's logo appears on their documents;
 * this is the app they're all signed in to. Pure black artwork; add `iso-invert` via className
 * to flip it white on dark chrome.
 */
export function AppLogo({ className = "" }: { className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand/consl-mark.png" alt="consl" className={`h-6 w-6 ${className}`} />;
}
