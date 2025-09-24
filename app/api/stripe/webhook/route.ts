// app/api/stripe/webhook/route.ts
import { NextResponse } from 'next/server';
import stripe from '@/lib/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const sig = req.headers.get('stripe-signature') || '';
    const body = await req.text();
    const secret = process.env.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET_PLATFORM || '';

    const event = stripe.webhooks.constructEvent(body, sig, secret);

    // … ta logique d’events (customer.subscription.*, checkout.session.completed, etc.)
    // Exemple update d’un metafield côté Shopify :
    const shop = process.env.SHOP_DOMAIN;
    void shop;

    return NextResponse.json({ received: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'webhook_error' }, { status: 400 });
  }
}
