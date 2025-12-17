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
  const url = `https://${shopDomain}/admin/api/2024-10/graphql.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": adminToken,
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });

  const json = await res.json();
  if (!res.ok || json?.errors?.length) {
    const msg =
      json?.errors?.[0]?.message || `Shopify GraphQL HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json as T;
}

export async function GET(req: NextRequest) {
  try {
    // 1) Vérif App Proxy (signature)
    const verified = verifyShopifyAppProxy(req, process.env.APP_PROXY_SHARED_SECRET);
    if (!verified.ok) {
      return NextResponse.json(
        { ok: false, error: "UNAUTHORIZED", reason: verified.reason },
        { status: 401 }
      );
    }

    // 2) Vérif client connecté (Shopify fournit logged_in_customer_id via App Proxy)
    const loggedCustomerId = verified.loggedInCustomerId;
    if (!loggedCustomerId) {
      return NextResponse.json(
        { ok: false, error: "NOT_LOGGED_IN" },
        { status: 401 }
      );
    }

    // 3) Paramètre productId
    const url = new URL(req.url);
    const productId = url.searchParams.get("productId");
    if (!productId) {
      return NextResponse.json(
        { ok: false, error: "MISSING_PRODUCT_ID" },
        { status: 400 }
      );
    }

    // 4) Env Shopify Admin
    const shopDomain = process.env.SHOP_DOMAIN;
    const adminToken = process.env.ADMIN_TOKEN;
    if (!shopDomain || !adminToken) {
      return NextResponse.json(
        { ok: false, error: "SERVER_MISCONFIG" },
        { status: 500 }
      );
    }

    const customerGid = `gid://shopify/Customer/${loggedCustomerId}`;
    const productGid = `gid://shopify/Product/${productId}`;

    // 5) Vérifier que ce customer a acheté ce product (scan des dernières commandes)
    const ORDERS_QUERY = `
      query OrdersByCustomer($query: String!) {
        orders(first: 50, query: $query, sortKey: CREATED_AT, reverse: true) {
          edges {
            node {
              id
              lineItems(first: 100) {
                edges {
                  node {
                    product { id }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const q = `customer_id:${loggedCustomerId} status:any`;
    const ordersRes = await shopifyGraphQL<any>(
      shopDomain,
      adminToken,
      ORDERS_QUERY,
      { query: q }
    );

    const orderEdges = ordersRes?.data?.orders?.edges || [];
    const hasPurchased = orderEdges.some((e: any) =>
      (e?.node?.lineItems?.edges || []).some(
        (li: any) => li?.node?.product?.id === productGid
      )
    );

    if (!hasPurchased) {
      return NextResponse.json(
        { ok: false, error: "NOT_PURCHASED" },
        { status: 403 }
      );
    }

    // 6) Récupérer le PDF depuis le metafield du produit
    const PRODUCT_PDF_QUERY = `
      query ProductPdf($id: ID!) {
        product(id: $id) {
          id
          metafield(namespace: "mfapp", key: "pdf_url") { value }
        }
      }
    `;

    const productRes = await shopifyGraphQL<any>(
      shopDomain,
      adminToken,
      PRODUCT_PDF_QUERY,
      { id: productGid }
    );

    const pdfUrl = productRes?.data?.product?.metafield?.value;
    if (!pdfUrl) {
      return NextResponse.json(
        { ok: false, error: "PDF_NOT_FOUND" },
        { status: 404 }
      );
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
