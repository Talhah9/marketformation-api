// app/api/stripe/portal/route.ts
import Stripe from "stripe";
import { handleOptions, jsonWithCors } from "@/app/api/_lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS(req: Request) {
  return handleOptions(req, { allowMethods: "POST, OPTIONS" });
}

export async function POST(req: Request) {
  const txt = await req.text();
  const { email, returnUrl } = txt ? JSON.parse(txt) : {};
  try {
    const key = process.env.STRIPE_SECRET_KEY?.trim();
    if (!key?.startsWith("sk_")) {
      return jsonWithCors(req, { ok:false, error:"Missing STRIPE_SECRET_KEY" }, { status:500 });
    }
    if (!email) {
      return jsonWithCors(req, { ok:false, error:"Missing email" }, { status:400 });
    }

    const stripe = new Stripe(key, { apiVersion: "2024-06-20" });
    const { data } = await stripe.customers.list({ email, limit: 1 });
    const customer = data[0] ?? (await stripe.customers.create({ email }));

    const session = await stripe.billingPortal.sessions.create({
      customer: customer.id,
      return_url: returnUrl || "https://tqiccz-96.myshopify.com/pages/mon-compte-formateur",
    });

    return jsonWithCors(req, { ok:true, url: session.url }, { status:200 });
  } catch (e:any) {
    return jsonWithCors(req, { ok:false, error: e?.message || "portal_failed" }, { status:500 });
  }
}
