// app/api/creator/subscribe/year/route.ts
import { handleOptions, jsonWithCors } from '@/app/api/_lib/cors';
import stripe from '@/lib/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Préflight CORS
export async function OPTIONS(req: Request) {
  return handleOptions(req, { allowMethods: 'POST, OPTIONS' });
}

export async function POST(req: Request) {
  // On lit le body une seule fois
  const bodyTxt = await req.text();
  const body = bodyTxt ? JSON.parse(bodyTxt) : {};
  const { diag, email, returnUrl } = body as {
    diag?: boolean;
    email?: string;
    returnUrl?: string;
  };

  // === DIAGNOSTIC (POST) : vérifier la présence des envs ===
  if (diag) {
    const price = process.env.STRIPE_PRICE_PRO_YEAR?.trim() || '';
    const key   = process.env.STRIPE_SECRET_KEY?.trim() || '';
    const env = {
      STRIPE_PRICE_PRO_YEAR: !!price,
      STRIPE_SECRET_KEY: !!key && key.startsWith('sk_')
    };

    let account: any = null, err: string | null = null;
    if (env.STRIPE_SECRET_KEY) {
      try {
        const acc = await stripe.accounts.retrieve();
        account = { id: acc.id, country: acc.country, type: acc.type };
      } catch (e: any) {
        err = e?.message || String(e);
      }
    }
    return jsonWithCors(req, { ok: true, env, stripe: { account, error: err } }, { status: 200 });
  }

  // === FLOW NORMAL ===
  try {
    const priceId = process.env.STRIPE_PRICE_PRO_YEAR;
    if (!priceId) {
      return jsonWithCors(req, { ok: false, error: 'STRIPE_PRICE_PRO_YEAR missing' }, { status: 500 });
    }

    // Base URL de retour : priorité au param, sinon FRONTEND_URL, sinon Shopify
    const base =
      (returnUrl && returnUrl.trim()) ||
      process.env.FRONTEND_URL ||
      'https://tqiccz-96.myshopify.com/pages/mon-compte-formateur';

    const success = `${base}${base.includes('?') ? '&' : '?'}sub=ok`;
    const cancel  = `${base}${base.includes('?') ? '&' : '?'}sub=cancel`;

    // Tu as déjà un client Stripe initialisé dans '@/lib/stripe'
    // On peut passer 'customer_email' si 'email' fourni (Stripe créera / associera)
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: success,
      cancel_url: cancel,
      ...(email ? { customer_email: email } : {}),
      allow_promotion_codes: true,
    });

    return jsonWithCors(req, { ok: true, url: session.url }, { status: 200 });
  } catch (e: any) {
    console.error('[Stripe][subscribe/year] error:', e?.message || e);
    return jsonWithCors(req, { ok: false, error: e?.message || 'create_session_failed' }, { status: 500 });
  }
}
