/** First initials of a name, e.g. "Pacific Botanicals" → "PB". Shared by supplier avatars
 *  on both the server-rendered card and the client editor. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}
