// app/api/subscription/route.ts
import Stripe from 'stripe';
import { NextResponse } from 'next/server';
import { priceIdToPlanKey } from '@/lib/plans';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });

// Shopify (pour retrouver l'email depuis l'ID client si besoin)
const STORE = process.env.SHOPIFY_STORE_DOMAIN!;
const TOKEN = process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN!;
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-07';

async function getShopifyCustomerEmail(id: number | string): Promise<string | null> {
  if (!STORE || !TOKEN) return null;
  const url = `https://${STORE}/admin/api/${API_VERSION}/customers/${id}.json`;
  const r = await fetch(url, {
    headers: {
      'X-Shopify-Access-Token': TOKEN,
      'Accept': 'application/json',
    },
    cache: 'no-store',
  });
  if (!r.ok) return null;
  const j = await r.json();
  return j?.customer?.email ?? null;
}

export async function POST(req: Request) {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json({ status: 'none', error: 'missing_STRIPE_SECRET_KEY' }, { status: 500 });
    }

    const { shopifyCustomerId, email } = await req.json().catch(() => ({} as any));

    // 1) Déterminer l'email à utiliser
    let customerEmail: string | null = email || null;
    if (!customerEmail && shopifyCustomerId) {
      customerEmail = await getShopifyCustomerEmail(shopifyCustomerId);
    }
    if (!customerEmail) {
      // Fallback ancien comportement (metadata) si jamais déjà en place
      // -> on laisse "none" proprement plutôt que 500
      return NextResponse.json({ status: 'none', reason: 'no_email' });
    }

    // 2) Retrouver le customer Stripe par email
    const list = await stripe.customers.list({ email: customerEmail, limit: 1 });
    const customer = list.data[0];
    if (!customer) return NextResponse.json({ status: 'none' });

    // 3) Lire ses abonnements
    const subs = await stripe.subscriptions.list({
      customer: customer.id,
      status: 'all',
      expand: ['data.items'],
      limit: 10,
    });
    const active = subs.data.find(s => ['active', 'trialing', 'past_due', 'unpaid'].includes(s.status));
    if (!active) return NextResponse.json({ status: 'none' });

    const priceId = active.items.data[0]?.price?.id || null;
    const planKey = priceId ? priceIdToPlanKey(priceId) : null;

    return NextResponse.json({
      status: active.status,
      planKey,
      currentPeriodEnd: active.current_period_end * 1000,
      customerId: customer.id,
    });
  } catch (err: any) {
    const msg = err?.message || err?.raw?.message || 'subscription_failed';
    const code = err?.statusCode || 500;
    return NextResponse.json({ status: 'none', error: msg }, { status: code });
  }
}
