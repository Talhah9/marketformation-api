// app/api/stripe/checkout/route.ts
import Stripe from "stripe";
import { handleOptions, jsonWithCors } from "@/app/api/_lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS(req: Request) { return handleOptions(req); }

// --- DIAG: GET /api/stripe/checkout?diag=1
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("diag") !== "1") {
    return jsonWithCors(req, { ok:false, error:"GET not allowed" }, { status:405 });
  }
  const raw = process.env.STRIPE_SECRET_KEY || "";
  const masked = raw ? `sk_${"*".repeat(Math.max(0, raw.length-10))}${raw.slice(-8)}` : null;
  const present = !!raw;
  const looksValid = raw.startsWith("sk_"); // accepte sk_live_ ou sk_test_
  let account: any = null, stripeErr: string | null = null;

  if (present && looksValid) {
    try {
      const stripe = new Stripe(raw, { apiVersion: "2024-06-20" });
      const acc = await stripe.accounts.retrieve();
      account = { id: acc.id, country: acc.country, email: acc.email || null, type: acc.type };
    } catch (e:any) {
      stripeErr = e?.message || String(e);
    }
  }
  return jsonWithCors(req, {
    ok: true,
    env: { present, masked, looksValid },
    stripe: { account, error: stripeErr }
  }, { status:200 });
}

export async function POST(req: Request) {
  try {
    const STRIPE_KEY = process.env.STRIPE_SECRET_KEY?.trim();
    if (!STRIPE_KEY || !STRIPE_KEY.startsWith("sk_")) {
      return jsonWithCors(req, { ok:false, error:"Missing STRIPE_SECRET_KEY" }, { status:500 });
    }
    const stripe = new Stripe(STRIPE_KEY, { apiVersion: "2024-06-20" });

    const { priceId, email, returnUrl } = await req.json();
    if (!priceId || !email) {
      return jsonWithCors(req, { ok:false, error:"Missing priceId or email" }, { status:400 });
    }

    const { data } = await stripe.customers.list({ email, limit: 1 });
    const customer = data[0] ?? (await stripe.customers.create({ email }));

    const base = returnUrl || "https://tqiccz-96.myshopify.com/pages/mon-compte-formateur";
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customer.id,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: `${base}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${base}?checkout=cancelled`,
    });

    return jsonWithCors(req, { ok:true, url: session.url }, { status:200 });
  } catch (e:any) {
    console.error("[Stripe][checkout] error:", e?.message || e);
    return jsonWithCors(req, { ok:false, error: e?.message || "checkout_failed" }, { status:500 });
  }
}
