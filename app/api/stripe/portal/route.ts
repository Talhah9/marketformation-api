import Stripe from "stripe";
import { handleOptions, jsonWithCors } from "@/app/api/_lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// OPTIONS (préflight CORS)
export async function OPTIONS(req: Request) {
  return handleOptions(req, { allowMethods: "POST, OPTIONS" });
}

export async function POST(req: Request) {
  const bodyTxt = await req.text();
  const body = bodyTxt ? JSON.parse(bodyTxt) : {};
  const { diag, email, returnUrl } = body as { diag?: boolean; email?: string; returnUrl?: string };

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
    if (!email) {
      return jsonWithCors(req, { ok:false, error:"Missing email" }, { status: 400 });
    }

    const stripe = new Stripe(STRIPE_KEY, { apiVersion: "2024-06-20" });

    const { data } = await stripe.customers.list({ email, limit: 1 });
    const customer = data[0];
    if (!customer) {
      return jsonWithCors(req, { ok:false, error:"Customer not found" }, { status: 404 });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customer.id,
      return_url: returnUrl || "https://tqiccz-96.myshopify.com/pages/mon-compte-formateur",
    });

    return jsonWithCors(req, { ok: true, url: session.url }, { status: 200 });
  } catch (e:any) {
    console.error("[Stripe][portal] error:", e?.message || e);
    return jsonWithCors(req, { ok:false, error: e?.message || "portal_failed" }, { status: 500 });
  }
}
