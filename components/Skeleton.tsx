/** A shimmering placeholder bar — size it with width/height classes. Purely decorative, so it's
 *  hidden from screen readers; the loading page announces itself once via aria-busy instead. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`skeleton ${className}`} />;
}
