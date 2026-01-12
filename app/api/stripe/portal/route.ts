// app/api/stripe/portal/route.ts
import Stripe from "stripe";
import { handleOptions, jsonWithCors } from "@/app/api/_lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS(req: Request) {
  // ✅ ton handleOptions prend 1 seul argument
  return handleOptions(req);
}

/**
 * POST body:
 * {
 *   email: string,
 *   shopifyCustomerId?: string | number,
 *   returnUrl?: string
 * }
 */
export async function POST(req: Request) {
  const txt = await req.text();
  const { email, shopifyCustomerId, returnUrl } = txt ? JSON.parse(txt) : {};

  try {
    const key = process.env.STRIPE_SECRET_KEY?.trim();
    if (!key?.startsWith("sk_")) {
      return jsonWithCors(req, { ok: false, error: "Missing STRIPE_SECRET_KEY" }, { status: 500 });
    }
    if (!email) {
      return jsonWithCors(req, { ok: false, error: "Missing email" }, { status: 400 });
    }

    const stripe = new Stripe(key, { apiVersion: "2024-06-20" });

    const { data } = await stripe.customers.list({ email, limit: 1 });
    let customer = data[0] ?? null;

    if (!customer) {
      customer = await stripe.customers.create({
        email,
        metadata: {
          ...(shopifyCustomerId ? { shopify_customer_id: String(shopifyCustomerId) } : {}),
        },
      });
    } else {
      if (shopifyCustomerId) {
        const cur = (customer.metadata?.shopify_customer_id || "").trim();
        const next = String(shopifyCustomerId).trim();
        if (!cur || cur !== next) {
          customer = await stripe.customers.update(customer.id, {
            metadata: { ...customer.metadata, shopify_customer_id: next },
          });
        }
      }
    }

    const fallback =
      process.env.SHOP_DOMAIN
        ? `https://${process.env.SHOP_DOMAIN}/pages/mon-compte-formateur`
        : "https://tqiccz-96.myshopify.com/pages/mon-compte-formateur";

    const session = await stripe.billingPortal.sessions.create({
      customer: customer.id,
      return_url: (returnUrl && String(returnUrl).trim()) || fallback,
    });

    return jsonWithCors(req, { ok: true, url: session.url }, { status: 200 });
  } catch (e: any) {
    console.error("[Stripe][portal] error:", e?.message || e);
    return jsonWithCors(req, { ok: false, error: e?.message || "portal_failed" }, { status: 500 });
  }
}
