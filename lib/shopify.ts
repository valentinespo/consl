import "server-only";

/**
 * Minimal Shopify Admin GraphQL client, per connected shop. The token is the shop's offline
 * access token from the OAuth flow (permanent until uninstall — no refresh dance like Amazon).
 * Version is pinned: quarterly Shopify releases are supported for ~12 months, so bump this
 * deliberately (and re-test the sync queries) rather than floating on "latest".
 */
export const SHOPIFY_API_VERSION = "2026-01";

export class ShopifyError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** Run one Admin API GraphQL operation against a shop. Throws on transport or GraphQL errors. */
export async function shopifyGraphQL<T = unknown>(
  shop: string,
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const r = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
    body: JSON.stringify({ query, variables }),
  });
  if (!r.ok) {
    const text = (await r.text()).slice(0, 200);
    throw new ShopifyError(`Shopify API ${r.status}: ${text}`, r.status);
  }
  const j = (await r.json()) as { data?: T; errors?: { message: string }[] };
  if (j.errors?.length) throw new ShopifyError(`Shopify GraphQL: ${j.errors.map((e) => e.message).join("; ").slice(0, 300)}`);
  if (!j.data) throw new ShopifyError("Shopify GraphQL: empty response");
  return j.data;
}
