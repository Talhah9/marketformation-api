// app/api/stripe/checkout/route.ts
import Stripe from "stripe";
import { handleOptions, jsonWithCors } from "@/app/api/_lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY; // <- aligne avec Vercel
const stripe = new Stripe(STRIPE_KEY || "", { apiVersion: "2024-06-20" });

export async function OPTIONS(req: Request) { return handleOptions(req); }

export async function POST(req: Request) {
  try {
    if (!STRIPE_KEY) {
      return jsonWithCors(req, { ok:false, error:"Missing STRIPE_SECRET_KEY" }, { status:500 });
    }

    const { priceId, email, returnUrl } = await req.json();
    if (!priceId || !email) {
      return jsonWithCors(req, { ok:false, error:"Missing priceId or email" }, { status:400 });
    }

    const { data } = await stripe.customers.list({ email, limit: 1 });
    const customer = data[0] ?? await stripe.customers.create({ email });

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customer.id,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: `${returnUrl}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${returnUrl}?checkout=cancelled`,
    });

    return jsonWithCors(req, { ok:true, url: session.url }, { status:200 });
  } catch (e:any) {
    console.error("[Stripe][checkout] error:", e?.message || e);
    return jsonWithCors(req, { ok:false, error: e?.message || "checkout_failed" }, { status:500 });
  }
}
