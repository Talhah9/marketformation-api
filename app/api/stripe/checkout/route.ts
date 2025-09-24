import Stripe from "stripe";
import { handleOptions, jsonWithCors } from "@/app/api/_lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// OPTIONS (préflight CORS)
export async function OPTIONS(req: Request) {
  return handleOptions(req, { allowMethods: "POST, OPTIONS" });
}

export async function POST(req: Request) {
  // On lit le body une seule fois
  const bodyTxt = await req.text();
  const body = bodyTxt ? JSON.parse(bodyTxt) : {};
  const { diag, priceId, email, returnUrl } = body as {
    diag?: boolean; priceId?: string; email?: string; returnUrl?: string;
  };

  // --- DIAGNOSTIC (POST)
  if (diag) {
    const key = process.env.STRIPE_SECRET_KEY?.trim() || "";
    const present = !!key;
    const looksValid = key.startsWith("sk_");
    let account: any = null, err: string | null = null;

    if (present && looksValid) {
      try {
        const stripe = new Stripe(key, { apiVersion: "2024-06-20" });
        const acc = await stripe.accounts.retrieve();
        account = { id: acc.id, country: acc.country, type: acc.type };
      } catch (e: any) { err = e?.message || String(e); }
    }
    return jsonWithCors(req, { ok: true, env: { present, looksValid }, stripe: { account, error: err } }, { status: 200 });
  }

  // --- FLOW NORMAL
  try {
    const STRIPE_KEY = process.env.STRIPE_SECRET_KEY?.trim();
    if (!STRIPE_KEY || !STRIPE_KEY.startsWith("sk_")) {
      return jsonWithCors(req, { ok:false, error:"Missing STRIPE_SECRET_KEY" }, { status: 500 });
    }
    if (!priceId || !email) {
      return jsonWithCors(req, { ok:false, error:"Missing priceId or email" }, { status: 400 });
    }

    const stripe = new Stripe(STRIPE_KEY, { apiVersion: "2024-06-20" });

    // retrouver/creer customer
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

    return jsonWithCors(req, { ok: true, url: session.url }, { status: 200 });
  } catch (e:any) {
    console.error("[Stripe][checkout] error:", e?.message || e);
    return jsonWithCors(req, { ok:false, error: e?.message || "checkout_failed" }, { status: 500 });
  }
}
