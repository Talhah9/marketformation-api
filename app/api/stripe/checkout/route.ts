import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { withCORS, corsOptions } from '@/app/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });

export async function OPTIONS(req: Request) { return corsOptions(req); }

export async function POST(req: Request) {
  try {
    const { priceId, email, returnUrl } = await req.json();
    if (!priceId || !email) return withCORS(req, NextResponse.json({ ok:false, error:'Missing priceId/email' }, { status:400 }));

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: email,
      success_url: returnUrl || 'https://tqiccz-96.myshopify.com/pages/mon-compte-formateur?success=1',
      cancel_url: returnUrl || 'https://tqiccz-96.myshopify.com/pages/mon-compte-formateur?canceled=1'
    });

    return withCORS(req, NextResponse.json({ ok:true, url: session.url }, { status:200 }));
  } catch (e:any) {
    console.error('checkout error', e);
    return withCORS(req, NextResponse.json({ ok:false, error: e.message || 'Stripe error' }, { status:500 }));
  }
}
