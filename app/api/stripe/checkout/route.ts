// app/api/billing/checkout/route.ts  (ou app/api/stripe/checkout/route.ts)
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
  email?: string | null;    // optionnel — auto remplira la session
  returnUrl?: string | null;// optionnel — fallback ci-dessous
  promoCode?: string | null;// optionnel — ex: TEST100
};

export async function POST(req: Request) {
  try {
    const ct = req.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      return jsonWithCors(req, { ok: false, error: 'content_type_required_json' }, { status: 415 });
    }

    const { priceId, email, returnUrl, promoCode } = (await req.json()) as CheckoutBody;
    if (!priceId) {
      return jsonWithCors(req, { ok: false, error: 'missing_priceId' }, { status: 400 });
    }

    // URL de retour par défaut (prod)
    const successBase =
      returnUrl ||
      process.env.MF_RETURN_URL ||
      'https://tqiccz-96.myshopify.com/pages/mon-compte-formateur';

    // (Option) Résolution du code promo vers un promotion_code id (promo_***)
    let discounts: Stripe.Checkout.SessionCreateParams.Discount[] | undefined = undefined;
    if (promoCode) {
      const list = await stripe.promotionCodes.list({ code: promoCode, active: true, limit: 1 });
      const pc = list.data[0];
      if (pc?.id) discounts = [{ promotion_code: pc.id }];
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: email || undefined,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${successBase}?ok=1`,
      cancel_url: `${successBase}?canceled=1`,

      // 👉 affiche le champ “Code promo” sur la page Stripe
      allow_promotion_codes: true,

      // 👉 auto-applique TEST100 si tu l’envoies dans le body
      ...(discounts ? { discounts } : {}),
    });

    return jsonWithCors(req, { ok: true, url: session.url });
  } catch (e: any) {
    console.error('[checkout] error', e);
    const msg = e?.raw?.message || e?.message || 'checkout_failed';
    return jsonWithCors(req, { ok: false, error: msg }, { status: 400 });
  }
}
