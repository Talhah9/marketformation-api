export const SHOP_DOMAIN =
  process.env.SHOP_DOMAIN || process.env.SHOPIFY_STORE_DOMAIN || "";

export const SHOP_API_VERSION =
  process.env.SHOP_API_VERSION || "2024-07";

export const ADMIN_TOKEN =
  process.env.SHOP_ADMIN_TOKEN ||
  process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN ||
  process.env.ADMIN_TOKEN ||
  "";

if (!SHOP_DOMAIN) throw new Error("Missing SHOP_DOMAIN env var");
if (!ADMIN_TOKEN) throw new Error("Missing Shopify Admin API token env var");

const BASE = `https://${SHOP_DOMAIN}/admin/api/${SHOP_API_VERSION}`;

export async function adminGraphQL(query: string, variables?: Record<string, unknown>) {
  const res = await fetch(`${BASE}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": ADMIN_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Shopify GraphQL ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function adminRest(path: string, init?: RequestInit) {
  const url = `${BASE}/${path.replace(/^\/+/, "")}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": ADMIN_TOKEN,
      ...(init?.headers as Record<string, string>),
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Shopify REST ${res.status}: ${await res.text()}`);
  return res.json();
}