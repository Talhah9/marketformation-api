import Stripe from "stripe";
import { optionsResponse, withCorsJSON } from '@/lib/cors';

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2024-06-20" });

export async function OPTIONS() {
  return optionsResponse();
}

export async function POST(req: Request) {
  try {
    const { customerId, returnUrl } = await req.json();
    if (!customerId) {
      return withCorsJSON({ ok: false, error: "Missing customerId" }, { status: 400 });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url:
        returnUrl ||
        "https://tqiccz-96.myshopify.com/pages/mon-compte-formateur",
    });

    return withCorsJSON({ ok: true, url: session.url }, { status: 200 });
  } catch (e: any) {
    console.error("portal error", e);
    return withCorsJSON({ ok: false, error: e?.message || "Stripe error" }, { status: 500 });
  }
}
