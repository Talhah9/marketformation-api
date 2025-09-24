// app/api/subscription/route.ts
import { jsonWithCors, handleOptions } from '@/app/api/_lib/cors';
import type Stripe from 'stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// --- Helpers Stripe (optionnels) ---
function hasStripe(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

function getStripe(): Stripe | null {
  if (!hasStripe()) return null;
  // lazy require pour éviter d'échouer au build si la clé manque
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const StripeLib = require('stripe') as typeof import('stripe');
  return new StripeLib(process.env.STRIPE_SECRET_KEY as string, { apiVersion: '2024-06-20' });
}

// Map priceId → planKey (aligne avec tes env / dashboard)
// Tu peux aussi mettre ces IDs en ENV : STRIPE_PRICE_STARTER, STRIPE_PRICE_PRO, STRIPE_PRICE_BUSINESS
const PRICE_TO_PLAN: Record<string, 'starter' | 'pro' | 'business'> = {
  [process.env.STRIPE_PRICE_STARTER || '']: 'starter',
  [process.env.STRIPE_PRICE_PRO || '']: 'pro',
  [process.env.STRIPE_PRICE_BUSINESS || '']: 'business',
};

type SubInfo = {
  planKey: 'starter' | 'pro' | 'business' | null;
  status: string | null;
  currentPeriodEnd: number | null; // epoch seconds
};

async function getPlanFor({
  email,
  shopifyCustomerId,
}: {
  email?: string;
  shopifyCustomerId?: string | number;
}): Promise<SubInfo> {
  // Pas de Stripe en ENV → renvoie un état neutre (front gère)
  if (!hasStripe()) {
    return { planKey: null, status: null, currentPeriodEnd: null };
  }

  const stripe = getStripe()!;
  // 1) Retrouver le customer
  let customer: Stripe.Customer | null = null;

  // a) par shopifyCustomerId en metadata si fourni
  if (shopifyCustomerId) {
    const list = await stripe.customers.search({
      query: `metadata['shopify_customer_id']:'${String(shopifyCustomerId)}'`,
      limit: 1,
    });
    customer = list.data[0] || null;
  }

  // b) sinon, par email
  if (!customer && email) {
    const list = await stripe.customers.list({ email, limit: 1 });
    customer = list.data[0] || null;
  }

  if (!customer) {
    return { planKey: null, status: null, currentPeriodEnd: null };
  }

  // 2) Récup abonnement actif le plus pertinent
  const subs = await stripe.subscriptions.list({
    customer: customer.id,
    status: 'all',
    limit: 10,
    expand: ['data.items.data.price'],
  });

  // Prendre un sub actif / trialing / past_due en priorité
  const preferred = subs.data.find(s =>
    ['active', 'trialing', 'past_due', 'unpaid'].includes(s.status),
  ) || subs.data[0];

  if (!preferred) {
    return { planKey: null, status: null, currentPeriodEnd: null };
  }

  const item = preferred.items?.data?.[0];
  const priceId = item?.price?.id || '';
  const planKey = PRICE_TO_PLAN[priceId] || (item?.price?.nickname as any) || null;
  const currentPeriodEnd = preferred.current_period_end || null;

  return {
    planKey: (planKey === 'starter' || planKey === 'pro' || planKey === 'business') ? planKey : null,
    status: preferred.status || null,
    currentPeriodEnd,
  };
}

export async function OPTIONS(req: Request) {
  return handleOptions(req);
}

export async function POST(req: Request) {
  try {
    const { email, shopifyCustomerId } = await req.json().catch(() => ({}));
    if (!email && !shopifyCustomerId) {
      return jsonWithCors(req, { ok: false, error: 'email or shopifyCustomerId required' }, { status: 400 });
    }

    const s = await getPlanFor({ email, shopifyCustomerId });
    // Pas de cache pour refléter l’état d’abonnement
    return jsonWithCors(
      req,
      { ok: true, ...s },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e: any) {
    return jsonWithCors(req, { ok: false, error: e?.message || 'subscription_failed' }, { status: 500 });
  }
}
