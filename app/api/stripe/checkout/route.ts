// app/api/stripe/checkout/route.ts
import Stripe from "stripe";
import { handleOptions, jsonWithCors } from "@/app/api/_lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const stripe = new Stripe(
  process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY_LIVE || process.env.STRIPE_LIVE_SECRET || "",
  { apiVersion: "2024-06-20" }
);

/** ---------- CORS preflight ---------- */
export async function OPTIONS(req: Request) {
  return handleOptions(req);
}

/** ---------- POST /api/stripe/checkout ----------
 * Body: { priceId: string, email: string, returnUrl: string }
 * Renvoie: { url: string }
 */
export async function POST(req: Request) {
  try {
    const { priceId, email, returnUrl } = await req.json();

    if (!priceId || !email) {
      return jsonWithCors(req, { error: "Missing priceId or email" }, { status: 400 });
    }

    // Retrouver/créer le customer
    const existing = await stripe.customers.list({ email, limit: 1 });
    const customer = existing.data[0] || (await stripe.customers.create({ email }));

    // Session Checkout (abonnement)
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customer.id,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: `${returnUrl}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${returnUrl}?checkout=cancelled`,
    });

    return jsonWithCors(req, { url: session.url });
  } catch (e: any) {
    console.error("checkout error", e);
    return jsonWithCors(req, { error: e?.message || "checkout_failed" }, { status: 500 });
  }
}
