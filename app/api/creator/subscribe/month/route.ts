import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";

export async function POST() {
  if (!process.env.STRIPE_PRICE_PRO_MONTH) {
    return NextResponse.json({ error: "STRIPE_PRICE_PRO_MONTH missing" }, { status: 500 });
  }
  const base = process.env.FRONTEND_URL || "https://marketformation.fr";
  const success = `${base}/pages/creator?sub=ok`;
  const cancel  = `${base}/pages/creator?sub=cancel`;

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: process.env.STRIPE_PRICE_PRO_MONTH, quantity: 1 }],
    success_url: success,
    cancel_url: cancel,
  });
  return NextResponse.json({ url: session.url });
}
