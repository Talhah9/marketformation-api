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

function ensureProxy(req: NextRequest) {
  const secret = process.env.APP_PROXY_SHARED_SECRET || "";
  return verifyShopifyAppProxy(req, secret);
}

function buildReturnUrls(returnUrl: string) {
  // returnUrl = page produit
  const success = new URL(returnUrl);
  success.searchParams.set("paid", "1");

  const cancel = new URL(returnUrl);
  cancel.searchParams.set("canceled", "1");

  return { success: success.toString(), cancel: cancel.toString() };
}

async function createCheckoutOrFreeRedirect(opts: {
  variantIdRaw: string;
  quantity: number;
  returnUrl: string;
}) {
  const { variantIdRaw, quantity, returnUrl } = opts;

  const gid = variantIdRaw.startsWith("gid://")
    ? variantIdRaw
    : `gid://shopify/ProductVariant/${variantIdRaw}`;

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
  if (!v?.price && v?.price !== "0.00") {
    return NextResponse.json({ ok: false, error: "variant_not_found_or_no_price" }, { status: 404 });
  }

  const currency = String(data?.shop?.currencyCode || "EUR").toLowerCase();
  const unit_amount = toCents(v.price);

  // ✅ GRATUIT (0€) -> pas Stripe -> on "valide" et on renvoie vers la page produit
  // (Important: pour un vrai accès sécurisé, tu dois enregistrer l’accès côté DB.
  // Ici on fait volontairement minimal pour ne rien casser.)
  if (unit_amount === 0) {
    const { success } = buildReturnUrls(returnUrl);
    const successUrl = new URL(success);
    successUrl.searchParams.set("free", "1");
    successUrl.searchParams.set("variant", String(variantIdRaw));
    return NextResponse.redirect(successUrl.toString(), 303);
  }

  // ✅ Stripe refuse les montants trop faibles (ex: < 0,50€)
  if (unit_amount > 0 && unit_amount < 50) {
    return NextResponse.json(
      {
        ok: false,
        error: "invalid_amount",
        hint: "Montant trop faible pour Stripe (< 0,50€). Mets un prix >= 0,50€ ou 0€ (gratuit).",
        debug: { variantId: variantIdRaw, shopifyPrice: v.price, unit_amount, currency },
      },
      { status: 400 }
    );
  }

  const name = `${v.product?.title || "Formation"} — ${v.title || "Variante"}`;
  const { success, cancel } = buildReturnUrls(returnUrl);

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
              shopify_variant_id: String(variantIdRaw),
              shopify_product_handle: String(v.product?.handle || ""),
            },
          },
        },
      },
    ],
    success_url: success,
    cancel_url: cancel,
    metadata: {
      shopify_variant_id: String(variantIdRaw),
      shopify_product_handle: String(v.product?.handle || ""),
    },
  });

  return NextResponse.redirect(session.url!, 303);
}

// ✅ GET (App Proxy friendly)
export async function GET(req: NextRequest) {
  try {
    if (!ensureProxy(req)) {
      return NextResponse.json({ ok: false, error: "invalid_proxy_signature" }, { status: 401 });
    }

    const url = req.nextUrl;
    const variantId = url.searchParams.get("variantId") || "";
    const quantity = Math.max(1, Number(url.searchParams.get("quantity") || "1"));
    const returnUrl = url.searchParams.get("returnUrl") || `${url.origin}/`;

    if (!variantId) {
      return NextResponse.json({ ok: false, error: "missing_variantId" }, { status: 400 });
    }

    return await createCheckoutOrFreeRedirect({ variantIdRaw: variantId, quantity, returnUrl });
  } catch (err: any) {
    console.error("[MF] /proxy/stripe/checkout GET error", err);
    return NextResponse.json({ ok: false, error: err?.message || "server_error" }, { status: 500 });
  }
}

// ✅ POST aussi, pour éviter les 405 si un ancien front envoie encore du POST
export async function POST(req: NextRequest) {
  try {
    if (!ensureProxy(req)) {
      return NextResponse.json({ ok: false, error: "invalid_proxy_signature" }, { status: 401 });
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch (_) {}

    const variantId = String(body?.variantId || "");
    const quantity = Math.max(1, Number(body?.quantity || 1));
    const returnUrl = String(body?.returnUrl || `${req.nextUrl.origin}/`);

    if (!variantId) {
      return NextResponse.json({ ok: false, error: "missing_variantId" }, { status: 400 });
    }

    return await createCheckoutOrFreeRedirect({ variantIdRaw: variantId, quantity, returnUrl });
  } catch (err: any) {
    console.error("[MF] /proxy/stripe/checkout POST error", err);
    return NextResponse.json({ ok: false, error: err?.message || "server_error" }, { status: 500 });
  }
}
