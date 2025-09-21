import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { withCORS, corsOptions } from '@/app/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });

export async function OPTIONS(req: Request) { return corsOptions(req); }

export async function POST(req: Request) {
  try {
    const { email } = await req.json();
    if (!email) return withCORS(req, NextResponse.json({ ok:false, error:'Missing email' }, { status:400 }));

    const list = await stripe.customers.list({ email, limit: 1 });
    const customer = list.data[0];
    if (!customer) return withCORS(req, NextResponse.json({ ok:true, planKey:null, status:null }), {});

    const subs = await stripe.subscriptions.list({ customer: customer.id, status: 'all', limit: 1 });
    const sub = subs.data[0];
    if (!sub) return withCORS(req, NextResponse.json({ ok:true, planKey:null, status:null }), {});

    const priceId = (sub.items.data[0]?.price?.id) || '';
    const planKey = /starter/i.test(priceId) ? 'starter' : /business/i.test(priceId) ? 'business' : 'pro';

    return withCORS(req, NextResponse.json({
      ok:true,
      planKey,
      status: sub.status,
      currentPeriodEnd: sub.current_period_end
    }, { status:200 }));
  } catch (e:any) {
    console.error('subscription error', e);
    return withCORS(req, NextResponse.json({ ok:false, error: e.message || 'Stripe error' }, { status:500 }));
  }
}
