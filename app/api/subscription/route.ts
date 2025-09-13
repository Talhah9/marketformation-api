// app/api/subscription/route.ts
import Stripe from 'stripe';
import { NextResponse } from 'next/server';
import { priceIdToPlanKey } from '@/lib/plans';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });

export async function POST(req: Request) {
  const { shopifyCustomerId } = await req.json();
  const found = await stripe.customers.search({ query: `metadata['shopify_customer_id']:'${shopifyCustomerId}'` });
  const customer = found.data[0];
  if (!customer) return NextResponse.json({ status: 'none' });

  const subs = await stripe.subscriptions.list({ customer: customer.id, status: 'all', expand: ['data.items'] });
  const active = subs.data.find(s => ['active','trialing','past_due','unpaid'].includes(s.status));
  if (!active) return NextResponse.json({ status: 'none' });

  const priceId = active.items.data[0]?.price?.id;
  const planKey = priceId ? priceIdToPlanKey(priceId) : null;

  return NextResponse.json({
    status: active.status,
    planKey,
    currentPeriodEnd: active.current_period_end * 1000,
  });
}
