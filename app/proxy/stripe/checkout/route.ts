import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { verifyShopifyAppProxy } from "@/app/api/_lib/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-06-20",
});

function mustVerifyProxy(req: NextRequest) {
  const secret = process.env.APP_PROXY_SHARED_SECRET || "";
  return verifyShopifyAppProxy(req, secret);
}

function getParams(req: NextRequest) {
  const url = req.nextUrl;
  const variantId = url.searchParams.get("variantId") || "";
  const quantity = Math.max(1, Number(url.searchParams.get("quantity") || "1"));
  const returnUrl = url.searchParams.get("returnUrl") || `${url.origin}/`;
  const priceId =
    url.searchParams.get("priceId") || // ✅ recommandé (Stripe Price ID)
    url.searchParams.get("stripePriceId") ||
    "";

  return { variantId, quantity, returnUrl, priceId };
}

// ✅ Shopify App Proxy appelle surtout en GET
export async function GET(req: NextRequest) {
  try {
    if (!mustVerifyProxy(req)) {
      return NextResponse.json({ ok: false, error: "invalid_proxy_signature" }, { status: 401 });
    }

    const { variantId, quantity, returnUrl, priceId } = getParams(req);

    // IMPORTANT :
    // - variantId = Shopify variant (utile si tu veux mapper côté serveur)
    // - priceId = Stripe Price ID (LE PLUS SIMPLE)
    if (!priceId) {
      return NextResponse.json(
        { ok: false, error: "missing_priceId", hint: "Pass priceId (Stripe Price ID) in query params." },
        { status: 400 }
      );
    }

    const success = new URL(returnUrl);
    success.searchParams.set("paid", "1");

    const cancel = new URL(returnUrl);
    cancel.searchParams.set("canceled", "1");

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity }],
      success_url: success.toString(),
      cancel_url: cancel.toString(),
      metadata: { variantId: variantId || "" },
    });

    return NextResponse.redirect(session.url!, 303);
  } catch (err: any) {
    console.error("[MF] proxy stripe/checkout GET error", err);
    return NextResponse.json({ ok: false, error: err?.message || "server_error" }, { status: 500 });
  }
}

// Optionnel : si un jour tu re-POST, tu évites le 405
export async function POST(req: NextRequest) {
  return NextResponse.json(
    { ok: false, error: "use_get", hint: "Use GET /apps/mf/stripe/checkout?priceId=...&variantId=..." },
    { status: 405 }
  );
}
