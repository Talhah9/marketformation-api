// app/proxy/courses/route.ts
import { NextRequest, NextResponse } from "next/server";
import { verifyShopifyAppProxy, getProxyViewer } from "@/app/api/_lib/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function withCors(res: NextResponse, req: NextRequest) {
  const origin = req.headers.get("origin") || "*";
  res.headers.set("Access-Control-Allow-Origin", origin);
  res.headers.set("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Origin, Accept, Content-Type");
  res.headers.set("Access-Control-Allow-Credentials", "true");
  res.headers.set("Vary", "Origin");
  return res;
}

export async function OPTIONS(req: NextRequest) {
  return withCors(new NextResponse(null, { status: 204 }), req);
}

export async function GET(req: NextRequest) {
  try {
    const secret = process.env.APP_PROXY_SHARED_SECRET || "";
    if (!verifyShopifyAppProxy(req, secret)) {
      return withCors(NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 }), req);
    }

    const { email } = getProxyViewer(req);
    if (!email) {
      return withCors(NextResponse.json({ ok: true, items: [], plan: "Unknown", quota: null }, { status: 200 }), req);
    }

    const shopDomain = process.env.SHOP_DOMAIN!;
    const adminToken = process.env.ADMIN_TOKEN!;
    if (!shopDomain || !adminToken) {
      return withCors(NextResponse.json({ ok: false, error: "missing_env" }, { status: 500 }), req);
    }

    // GraphQL: produits dont vendor = email
    const query = `
      query ProductsByVendor($q: String!) {
        products(first: 50, query: $q, sortKey: CREATED_AT, reverse: true) {
          edges {
            node {
              id
              title
              handle
              vendor
              createdAt
              publishedAt
              featuredImage { url }
              metafield(namespace: "mfapp", key: "theme") { value }
              metafield2: metafield(namespace: "mfapp", key: "theme_label") { value }
            }
          }
        }
      }
    `;

    const q = `vendor:"${email}"`;
    const r = await fetch(`https://${shopDomain}/admin/api/2025-10/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": adminToken,
      },
      body: JSON.stringify({ query, variables: { q } }),
    });

    const j = await r.json();
    const edges = j?.data?.products?.edges || [];

    const items = edges.map((e: any) => {
      const p = e.node;
      const gid = String(p.id || "");
      const numericId = gid.includes("/Product/") ? Number(gid.split("/Product/")[1]) : null;

      return {
        id: numericId ?? gid,
        title: p.title,
        handle: p.handle,
        url: p.handle ? `/products/${p.handle}` : "#",
        image_url: p.featuredImage?.url || "",
        coverUrl: p.featuredImage?.url || "",
        createdAt: p.createdAt,
        published: !!p.publishedAt,
        published_at: p.publishedAt,
        mf_theme: p.metafield?.value || "",
        theme_label: p.metafield2?.value || "",
        status: p.publishedAt ? "published" : "draft",
      };
    });

    return withCors(
      NextResponse.json({ ok: true, items, plan: "Unknown", quota: null }, { status: 200 }),
      req
    );
  } catch (e) {
    console.error("[MF] /proxy/courses GET error", e);
    return withCors(NextResponse.json({ ok: false, error: "server_error" }, { status: 500 }), req);
  }
}
