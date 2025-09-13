// app/api/stripe/checkout/route.ts
import Stripe from 'stripe';
import { NextResponse } from 'next/server';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });

export async function POST(req: Request) {
  const { priceId, shopifyCustomerId, email, returnUrl } = await req.json();

  // 1) retrouver ou créer le customer Stripe
  const found = await stripe.customers.search({ query: `metadata['shopify_customer_id']:'${shopifyCustomerId}'` });
  const customer = found.data[0] ?? await stripe.customers.create({
    email, metadata: { shopify_customer_id: String(shopifyCustomerId) }
  });

  // 2) créer la session de checkout (mode subscription)
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    customer: customer.id,
    allow_promotion_codes: true,
    success_url: `${returnUrl}?status=success`,
    cancel_url: `${returnUrl}?status=cancel`,
  });

  return NextResponse.json({ url: session.url });
}
