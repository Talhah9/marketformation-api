import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyShopifyAppProxy } from "@/app/api/_lib/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function shopifyGraphQL<T>(
  shopDomain: string,
  adminToken: string,
  query: string,
  variables: Record<string, any>
): Promise<T> {
  const res = await fetch(`https://${shopDomain}/admin/api/2024-10/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": adminToken,
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });

  const json = await res.json().catch(() => null);
  if (!res.ok || !json) throw new Error(`Shopify GraphQL HTTP ${res.status}`);
  if (json.errors?.length) throw new Error(json.errors[0]?.message || "Shopify GraphQL error");
  return json as T;
}

export async function GET(req: NextRequest) {
  try {
    // 1) Vérif App Proxy
    const verified = verifyShopifyAppProxy(req, process.env.APP_PROXY_SHARED_SECRET);
    if (!verified.ok) {
      return NextResponse.json(
        { ok: false, error: "UNAUTHORIZED", reason: verified.reason },
        { status: 401 }
      );
    }

    // 2) Client connecté (Shopify app proxy)
    const loggedCustomerId = verified.loggedInCustomerId;
    if (!loggedCustomerId) {
      return NextResponse.json({ ok: false, error: "NOT_LOGGED_IN" }, { status: 401 });
    }

    // 3) productId
    const url = new URL(req.url);
    const productId = url.searchParams.get("productId");
    if (!productId) {
      return NextResponse.json({ ok: false, error: "MISSING_PRODUCT_ID" }, { status: 400 });
    }

    // 4) Env
    const shopDomain = process.env.SHOP_DOMAIN;
    const adminToken = process.env.ADMIN_TOKEN;
    if (!shopDomain || !adminToken) {
      return NextResponse.json({ ok: false, error: "SERVER_MISCONFIG" }, { status: 500 });
    }

    const productGid = `gid://shopify/Product/${productId}`;

    // 5) Vérifier achat : commandes du customer, scan lineItems.product.id
    const ORDERS_QUERY = `
      query OrdersByCustomer($query: String!) {
        orders(first: 50, query: $query, sortKey: CREATED_AT, reverse: true) {
          edges {
            node {
              id
              lineItems(first: 100) {
                edges {
                  node { product { id } }
                }
              }
            }
          }
        }
      }
    `;

    const ordersSearch = `customer_id:${loggedCustomerId} status:any`;
    const ordersRes = await shopifyGraphQL<any>(shopDomain, adminToken, ORDERS_QUERY, {
      query: ordersSearch,
    });

    const hasPurchased = (ordersRes?.data?.orders?.edges || []).some((e: any) =>
      (e?.node?.lineItems?.edges || []).some((li: any) => li?.node?.product?.id === productGid)
    );

    if (!hasPurchased) {
      return NextResponse.json({ ok: false, error: "NOT_PURCHASED" }, { status: 403 });
    }

    // 6) Lire mfapp.pdf_url sur le produit
    const PRODUCT_QUERY = `
      query ProductPdf($id: ID!) {
        product(id: $id) {
          id
          metafield(namespace: "mfapp", key: "pdf_url") { value }
        }
      }
    `;

    const productRes = await shopifyGraphQL<any>(shopDomain, adminToken, PRODUCT_QUERY, {
      id: productGid,
    });

    const pdfUrl = productRes?.data?.product?.metafield?.value;
    if (!pdfUrl) {
      return NextResponse.json({ ok: false, error: "PDF_NOT_FOUND" }, { status: 404 });
    }

    // 7) Redirect vers le PDF (MVP)
    const resp = NextResponse.redirect(pdfUrl, 302);
    resp.headers.set("Cache-Control", "no-store");
    return resp;
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "DOWNLOAD_PROXY_EXCEPTION", message: e?.message || "unknown" },
      { status: 500 }
    );
  }
}
