// app/api/stripe/checkout/route.ts
import Stripe from 'stripe';
import { handleOptions, jsonWithCors } from '@/app/api/_lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });

type CheckoutBody = {
  priceId: string;                   // ex: price_...
  shopifyCustomerId?: number|string; // ID client Shopify
  email?: string;                    // email formateur (facilite la recherche)
  returnUrl: string;                 // URL Shopify existante (ex: /pages/mon-compte-formateur)
};

export async function OPTIONS(req: Request) {
  return handleOptions(req);
}

export async function POST(req: Request) {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return jsonWithCors(req, { error: 'missing_STRIPE_SECRET_KEY' }, { status: 500 });
    }

    const { priceId, shopifyCustomerId, email, returnUrl } = (await req.json()) as CheckoutBody;

    if (!priceId || !priceId.startsWith('price_')) {
      return jsonWithCors(req, { error: 'invalid_priceId' }, { status: 400 });
    }
    if (!returnUrl) {
      return jsonWithCors(req, { error: 'missing_returnUrl' }, { status: 400 });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${returnUrl}?status=success`,
      cancel_url: `${returnUrl}?status=cancel`,
      customer_email: email || undefined,
      allow_promotion_codes: true,

      // 🔗 Recommandation : lier l’ID client Shopify sur l’abonnement lui-même
      subscription_data: {
        metadata: {
          shopify_customer_id: shopifyCustomerId ? String(shopifyCustomerId) : '',
          plan_from_price: priceId,
          project: 'Marketformation',
        },
      },

      // (optionnel) pour debugging côté session
      metadata: {
        shopify_customer_id: shopifyCustomerId ? String(shopifyCustomerId) : '',
        plan_from_price: priceId,
        project: 'Marketformation',
      },
    });

    return jsonWithCors(req, { url: session.url });
  } catch (err: any) {
    console.error('stripe.checkout error:', err?.type || err?.name, err?.message || err?.raw?.message);
    const msg = err?.raw?.message || err?.message || 'checkout_failed';
    const code = err?.statusCode || 500;
    return jsonWithCors(req, { error: msg }, { status: code });
  }
}
