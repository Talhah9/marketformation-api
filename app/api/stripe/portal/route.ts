import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { withCORS, corsOptions } from '@/app/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });

export async function OPTIONS(req: Request) { return corsOptions(req); }

export async function POST(req: Request) {
  try {
    const { email, returnUrl } = await req.json();
    if (!email) return withCORS(req, NextResponse.json({ ok:false, error:'Missing email' }, { status:400 }));

    // trouver/creer customer
    const list = await stripe.customers.list({ email, limit: 1 });
    const customer = list.data[0] || await stripe.customers.create({ email });

    const portal = await stripe.billingPortal.sessions.create({
      customer: customer.id,
      return_url: returnUrl || 'https://tqiccz-96.myshopify.com/pages/mon-compte-formateur'
    });

    return withCORS(req, NextResponse.json({ ok:true, url: portal.url }, { status:200 }));
  } catch (e:any) {
    console.error('portal error', e);
    return withCORS(req, NextResponse.json({ ok:false, error: e.message || 'Stripe error' }, { status:500 }));
  }
}
