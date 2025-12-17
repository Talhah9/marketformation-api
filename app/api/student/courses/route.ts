// app/proxy/download/route.ts
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

function redirectBack(req: NextRequest, code: string) {
  // ⚠️ adapte si ta page élève a un autre handle
  const back = new URL("/pages/mes-formations", req.nextUrl.origin);
  back.searchParams.set("mf_error", code);
  return NextResponse.redirect(back.toString(), 302);
}

export async function GET(req: NextRequest) {
  try {
    // 1) Vérif App Proxy
    const verified = verifyShopifyAppProxy(req, process.env.APP_PROXY_SHARED_SECRET);
    if (!verified.ok) return redirectBack(req, "unauthorized");

    // 2) Client connecté
    const loggedCustomerId = verified.loggedInCustomerId;
    if (!loggedCustomerId) return redirectBack(req, "not_logged_in");

    // 3) productId
    const url = new URL(req.url);
    const productId = url.searchParams.get("productId");
    if (!productId) return redirectBack(req, "missing_product_id");

    // 4) Env
    const shopDomain = process.env.SHOP_DOMAIN;
    const adminToken = process.env.ADMIN_TOKEN;
    if (!shopDomain || !adminToken) return redirectBack(req, "server_misconfig");

    const productGid = `gid://shopify/Product/${productId}`;

    // 5) Vérifier achat (scan commandes)
    const ORDERS_QUERY = `
      query OrdersByCustomer($query: String!) {
        orders(first: 50, query: $query, sortKey: CREATED_AT, reverse: true) {
          edges {
            node {
              id
              lineItems(first: 100) {
                edges { node { product { id } } }
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

    if (!hasPurchased) return redirectBack(req, "not_purchased");

    // 6) Lire mfapp.pdf_url
    const PRODUCT_QUERY = `
      query ProductPdf($id: ID!) {
        product(id: $id) {
          metafield(namespace: "mfapp", key: "pdf_url") { value }
        }
      }
    `;
    const productRes = await shopifyGraphQL<any>(shopDomain, adminToken, PRODUCT_QUERY, {
      id: productGid,
    });

    const pdfUrl = productRes?.data?.product?.metafield?.value;
    if (!pdfUrl) return redirectBack(req, "pdf_not_found");

    // 7) Redirect vers le PDF
    const resp = NextResponse.redirect(pdfUrl, 302);
    resp.headers.set("Cache-Control", "no-store");
    return resp;
  } catch (e: any) {
    console.error("[MF] proxy/download exception:", e?.message || e);
    return redirectBack(req, "download_exception");
  }
}
