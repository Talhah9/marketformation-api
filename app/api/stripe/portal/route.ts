// app/api/stripe/portal/route.ts
import Stripe from "stripe";
import { handleOptions, jsonWithCors } from "@/app/api/_lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS(req: Request) {
  return handleOptions(req);
}

export async function POST(req: Request) {
  try {
    // ✅ même nom d'ENV que pour checkout
    const STRIPE_KEY = process.env.STRIPE_SECRET_KEY?.trim();
    if (!STRIPE_KEY || !STRIPE_KEY.startsWith("sk_")) {
      return jsonWithCors(req, { ok:false, error: "Missing STRIPE_SECRET_KEY" }, { status: 500 });
    }
    // ✅ instanciation DANS le handler (pas en haut du fichier)
    const stripe = new Stripe(STRIPE_KEY, { apiVersion: "2024-06-20" });

    const { email, returnUrl } = await req.json();
    if (!email) {
      return jsonWithCors(req, { ok:false, error: "Missing email" }, { status: 400 });
    }

    // retrouver le customer par email (exige l'existence)
    const existing = await stripe.customers.list({ email, limit: 1 });
    const customer = existing.data[0];
    if (!customer) {
      return jsonWithCors(req, { ok:false, error: "Customer not found" }, { status: 404 });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customer.id,
      return_url: returnUrl || "https://tqiccz-96.myshopify.com/pages/mon-compte-formateur",
    });

    return jsonWithCors(req, { ok:true, url: session.url }, { status: 200 });
  } catch (e:any) {
    console.error("[Stripe][portal] error:", e?.message || e);
    // ✅ renvoyer un vrai code d'erreur (pas 200)
    return jsonWithCors(req, { ok:false, error: e?.message || "portal_failed" }, { status: 500 });
  }
}
