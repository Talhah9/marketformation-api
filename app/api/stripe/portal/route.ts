// app/api/stripe/portal/route.ts
import Stripe from 'stripe';
import { NextResponse } from 'next/server';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });

export async function POST(req: Request) {
  const { shopifyCustomerId, returnUrl } = await req.json();
  const found = await stripe.customers.search({ query: `metadata['shopify_customer_id']:'${shopifyCustomerId}'` });
  const customer = found.data[0];
  if (!customer) return NextResponse.json({ error: 'Aucun client Stripe' }, { status: 404 });

  const portal = await stripe.billingPortal.sessions.create({
    customer: customer.id,
    return_url: returnUrl,
  });
  return NextResponse.json({ url: portal.url });
}
