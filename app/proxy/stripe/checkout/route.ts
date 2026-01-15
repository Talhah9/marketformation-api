// app/proxy/stripe/checkout/route.ts
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { verifyShopifyAppProxy } from "@/app/api/_lib/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2024-06-20" });

function toCents(priceStr: string): number {
  const s = String(priceStr || "").replace(",", ".").trim();
  if (!s) return 0;
  const [a, b = ""] = s.split(".");
  const euros = parseInt(a || "0", 10);
  const cents = parseInt((b + "00").slice(0, 2), 10);
  return euros * 100 + cents;
}

async function shopifyGraphQL(query: string, variables: any) {
  const shop = process.env.SHOP_DOMAIN!;
  const token = process.env.ADMIN_TOKEN!;
  const res = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await res.json();
  if (!res.ok || json.errors) {
    throw new Error(json?.errors?.[0]?.message || `Shopify GraphQL error (${res.status})`);
  }
  return json.data;
}

export async function GET(req: NextRequest) {
  try {
    // ✅ Vérif signature App Proxy
    const secret = process.env.APP_PROXY_SHARED_SECRET || "";
    if (!verifyShopifyAppProxy(req, secret)) {
      return NextResponse.json({ ok: false, error: "invalid_proxy_signature" }, { status: 401 });
    }

    const url = req.nextUrl;
    const variantId = url.searchParams.get("variantId") || "";
    const quantity = Math.max(1, Number(url.searchParams.get("quantity") || "1"));
    const returnUrl = url.searchParams.get("returnUrl") || `${url.origin}/`;

    if (!variantId) {
      return NextResponse.json({ ok: false, error: "missing_variantId" }, { status: 400 });
    }

    const gid = variantId.startsWith("gid://")
      ? variantId
      : `gid://shopify/ProductVariant/${variantId}`;

    const data = await shopifyGraphQL(
      `
      query Variant($id: ID!) {
        productVariant(id: $id) {
          id
          title
          price
          product { title handle }
        }
        shop { currencyCode }
      }
      `,
      { id: gid }
    );

    const v = data?.productVariant;
    if (!v?.price) {
      return NextResponse.json(
        { ok: false, error: "variant_not_found_or_no_price" },
        { status: 404 }
      );
    }

    const currency = String(data?.shop?.currencyCode || "EUR").toLowerCase();
    const unit_amount = toCents(v.price);
    if (!unit_amount || unit_amount < 50) {
      return NextResponse.json({ ok: false, error: "invalid_amount" }, { status: 400 });
    }

    const name = `${v.product?.title || "Formation"} — ${v.title || "Variante"}`;

    const success = new URL(returnUrl);
    success.searchParams.set("paid", "1");

    const cancel = new URL(returnUrl);
    cancel.searchParams.set("canceled", "1");

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity,
          price_data: {
            currency,
            unit_amount,
            product_data: {
              name,
              metadata: {
                shopify_variant_id: String(variantId),
                shopify_product_handle: String(v.product?.handle || ""),
              },
            },
          },
        },
      ],
      success_url: success.toString(),
      cancel_url: cancel.toString(),
      metadata: {
        shopify_variant_id: String(variantId),
        shopify_product_handle: String(v.product?.handle || ""),
      },
    });

    return NextResponse.redirect(session.url!, 303);
  } catch (err: any) {
    console.error("[MF] /apps/mf/stripe/checkout GET error", err);
    return NextResponse.json({ ok: false, error: err?.message || "server_error" }, { status: 500 });
  }
}

// Optionnel: renvoie 405 proprement si quelqu’un POST
export async function POST() {
  return NextResponse.json(
    { ok: false, error: "method_not_allowed", hint: "Use GET with variantId." },
    { status: 405 }
  );
}
