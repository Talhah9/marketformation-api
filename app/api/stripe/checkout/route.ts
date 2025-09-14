// app/api/stripe/checkout/route.ts
// Checkout minimal : reçoit { priceId, email?, returnUrl? } et renvoie { url }
import { handleOptions, jsonWithCors } from '@/app/api/_lib/cors';
import Stripe from 'stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY!;
const stripe = new Stripe(STRIPE_KEY, { apiVersion: '2024-06-20' });

// CORS preflight
export async function OPTIONS(req: Request) {
  return handleOptions(req);
}

type CheckoutBody = {
  priceId: string;          // ex: price_live_...
  email?: string | null;    // optionnel
  returnUrl?: string | null;// optionnel
};

export async function POST(req: Request) {
  try {
    const ct = req.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      return jsonWithCors(req, { ok: false, error: 'content_type_required_json' }, { status: 415 });
    }

    const { priceId, email, returnUrl } = (await req.json()) as CheckoutBody;
    if (!priceId) {
      return jsonWithCors(req, { ok: false, error: 'missing_priceId' }, { status: 400 });
    }

    // URL de retour par défaut
    const successBase =
      returnUrl ||
      process.env.MF_RETURN_URL ||
      'https://tqiccz-96.myshopify.com/pages/mon-compte-formateur';

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: email || undefined,
      success_url: `${successBase}?ok=1`,
      cancel_url: `${successBase}?canceled=1`,
      // Pas de promo codes / discounts ici (version simple)
    });

    return jsonWithCors(req, { ok: true, url: session.url });
  } catch (e: any) {
    console.error('[checkout] error', e);
    const msg = e?.raw?.message || e?.message || 'checkout_failed';
    return jsonWithCors(req, { ok: false, error: msg }, { status: 400 });
  }
}
