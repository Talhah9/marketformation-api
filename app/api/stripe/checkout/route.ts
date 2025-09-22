import Stripe from "stripe";
import { optionsResponse, withCorsJSON } from '@/lib/cors';


export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-06-20",
});

export async function OPTIONS() {
  // Répondre au préflight
  return optionsResponse();
}

export async function POST(req: Request) {
  try {
    const { priceId, email, returnUrl } = await req.json();
    if (!priceId || !email) {
      return withCorsJSON({ ok: false, error: "Missing priceId/email" }, { status: 400 });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: email,
      success_url:
        returnUrl ||
        "https://tqiccz-96.myshopify.com/pages/mon-compte-formateur?success=1",
      cancel_url:
        returnUrl ||
        "https://tqiccz-96.myshopify.com/pages/mon-compte-formateur?canceled=1",
    });

    return withCorsJSON({ ok: true, url: session.url }, { status: 200 });
  } catch (e: any) {
    console.error("checkout error", e);
    return withCorsJSON(
      { ok: false, error: e?.message || "Stripe error" },
      { status: 500 }
    );
  }
}
