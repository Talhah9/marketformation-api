// app/api/stripe/portal/route.ts
import Stripe from "stripe";
import { handleOptions, jsonWithCors } from "@/app/api/_lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY_LIVE as string, { apiVersion: "2024-06-20" });

export async function OPTIONS(req: Request) { return handleOptions(req); }

export async function POST(req: Request) {
  try {
    const { email, returnUrl } = await req.json();
    if (!email) return jsonWithCors(req, { error: "Missing email" }, { status: 400 });

    const existing = await stripe.customers.list({ email, limit: 1 });
    const customer = existing.data[0];
    if (!customer) return jsonWithCors(req, { error: "Customer not found" }, { status: 404 });

    const session = await stripe.billingPortal.sessions.create({
      customer: customer.id, return_url: returnUrl
    });

    return jsonWithCors(req, { url: session.url });
  } catch (e:any) {
    return jsonWithCors(req, { error: e?.message || "portal_failed" }, { status: 200 });
  }
}
