// app/api/subscription/route.ts
import Stripe from 'stripe';
import { NextResponse } from 'next/server';
import { priceIdToPlanKey } from '@/lib/plans';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });

const STORE = process.env.SHOPIFY_STORE_DOMAIN!;
const TOKEN = process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN!;
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-07';

async function getShopifyCustomerEmail(id: number | string): Promise<string | null> {
  if (!STORE || !TOKEN) return null;
  const url = `https://${STORE}/admin/api/${API_VERSION}/customers/${id}.json`;
  const r = await fetch(url, {
    headers: { 'X-Shopify-Access-Token': TOKEN, 'Accept': 'application/json' },
    cache: 'no-store',
  });
  if (!r.ok) return null;
  const j = await r.json();
  return j?.customer?.email ?? null;
}

type PlanKey = 'starter' | 'pro' | 'business';

function inferPlanKeyFromPriceObj(p: Stripe.Price): PlanKey | null {
  const name = `${p.nickname || ''} ${(typeof p.product !== 'string' && p.product?.name) || ''}`.toLowerCase();
  if (name.includes('starter')) return 'starter';
  if (name.includes('pro')) return 'pro';
  if (name.includes('business') || name.includes('entreprise')) return 'business';
  switch (p.unit_amount) {
    case 1990: return 'starter';
    case 3990: return 'pro';
    case 6990: return 'business';
    default: return null;
  }
}

export async function POST(req: Request) {
  try {
    const { shopifyCustomerId, email } = await req.json().catch(() => ({}));

    // 1) email à partir du body ou de Shopify
    let customerEmail: string | null = email || null;
    if (!customerEmail && shopifyCustomerId) {
      customerEmail = await getShopifyCustomerEmail(shopifyCustomerId);
    }
    if (!customerEmail) return NextResponse.json({ status: 'none', reason: 'no_email' });

    // 2) retrouver le customer Stripe par email
    const list = await stripe.customers.list({ email: customerEmail, limit: 1 });
    const customer = list.data[0];
    if (!customer) return NextResponse.json({ status: 'none' });

    // 3) trouver un abonnement actif
    const subs = await stripe.subscriptions.list({
      customer: customer.id,
      status: 'all',
      expand: ['data.items.data.price.product'],
      limit: 10,
    });
    const active = subs.data.find(s => ['active','trialing','past_due','unpaid'].includes(s.status));
    if (!active) return NextResponse.json({ status: 'none' });

    const price = active.items.data[0]?.price as Stripe.Price | undefined;
    const priceId = price?.id || null;

    // 4) mapping vers planKey
    let planKey: PlanKey | null = priceId ? (priceIdToPlanKey(priceId) as PlanKey | null) : null;
    if (!planKey && price) {
      // fallback sans ENV: nom/nickname/amount
      planKey = inferPlanKeyFromPriceObj(price);
      // dernier secours: lire la metadata posée au checkout
      if (!planKey && active.metadata?.plan_from_price) {
        const pid = active.metadata.plan_from_price;
        planKey = priceIdToPlanKey(pid) as PlanKey | null;
      }
      // si toujours rien, on tente une requête price->product (déjà expand ci-dessus normalement)
      if (!planKey && priceId) {
        const pr = await stripe.prices.retrieve(priceId, { expand: ['product'] });
        planKey = inferPlanKeyFromPriceObj(pr);
      }
    }

    return NextResponse.json({
      status: active.status,
      planKey,
      currentPeriodEnd: active.current_period_end * 1000,
      customerId: customer.id,
      priceId,
    });
  } catch (err: any) {
    const msg = err?.message || err?.raw?.message || 'subscription_failed';
    const code = err?.statusCode || 500;
    return NextResponse.json({ status: 'none', error: msg }, { status: code });
  }
}
