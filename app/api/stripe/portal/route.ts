// app/api/stripe/portal/route.ts
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

/** ---------- POST /api/stripe/portal ----------
 * Body: { email: string, returnUrl: string }
 * Renvoie: { url: string }
 */
export async function POST(req: Request) {
  try {
    const { email, returnUrl } = await req.json();
    if (!email) return jsonWithCors(req, { error: "Missing email" }, { status: 400 });

    const existing = await stripe.customers.list({ email, limit: 1 });
    const customer = existing.data[0];
    if (!customer) return jsonWithCors(req, { error: "Customer not found" }, { status: 404 });

    const session = await stripe.billingPortal.sessions.create({
      customer: customer.id,
      return_url: returnUrl,
    });

    return jsonWithCors(req, { url: session.url });
  } catch (e: any) {
    console.error("portal error", e);
    return jsonWithCors(req, { error: e?.message || "portal_failed" }, { status: 500 });
  }
}
