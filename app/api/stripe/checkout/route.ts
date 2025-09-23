// app/api/stripe/checkout/route.ts  (Next.js App Router)
// ou pages/api/stripe/checkout.ts (Pages Router)

import Stripe from 'stripe';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs'; // <-- IMPORTANT: pas 'edge'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: '2024-06-20',
});

export async function POST(req: Request) {
  try {
    const { priceId, email, returnUrl } = await req.json();

    if (!process.env.STRIPE_SECRET_KEY) {
      console.error('[Stripe] STRIPE_SECRET_KEY manquante');
      return NextResponse.json({ ok:false, error:'Server is misconfigured: missing STRIPE_SECRET_KEY' }, { status: 500 });
    }
    if (!priceId) {
      return NextResponse.json({ ok:false, error:'Missing priceId' }, { status: 400 });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: email || undefined,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: (returnUrl || 'https://ton-domaine.tld') + '?checkout=success',
      cancel_url: (returnUrl || 'https://ton-domaine.tld') + '?checkout=cancel',
    });

    return NextResponse.json({ ok:true, url: session.url }, { status: 200 });
  } catch (err:any) {
    console.error('[Stripe][checkout] error:', err);
    return NextResponse.json({ ok:false, error: err?.message || 'Stripe error' }, { status: 500 });
  }
}
