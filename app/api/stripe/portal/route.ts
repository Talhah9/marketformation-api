// app/api/stripe/portal/route.ts
import Stripe from 'stripe';
import { handleOptions, jsonWithCors } from '@/app/api/_lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Préflight CORS
export async function OPTIONS(req: Request) {
  // Si ton handleOptions accepte des options, on précise les méthodes autorisées
  return handleOptions(req, { allowMethods: 'POST, OPTIONS' });
}

export async function POST(req: Request) {
  const bodyTxt = await req.text();
  const body = bodyTxt ? JSON.parse(bodyTxt) : {};
  const { diag, email, returnUrl } = body as {
    diag?: boolean;
    email?: string;
    returnUrl?: string;
  };

  // --- Mode diagnostic (optionnel) ---
  if (diag) {
    const key = process.env.STRIPE_SECRET_KEY?.trim() || '';
    const present = !!key;
    const looksValid = key.startsWith('sk_');
    let account: any = null, err: string | null = null;

    if (present && looksValid) {
      try {
        const stripe = new Stripe(key, { apiVersion: '2024-06-20' });
        const acc = await stripe.accounts.retrieve();
        account = { id: acc.id, country: acc.country, type: acc.type };
      } catch (e: any) {
        err = e?.message || String(e);
      }
    }
    return jsonWithCors(
      req,
      { ok: true, env: { present, looksValid }, stripe: { account, error: err } },
      { status: 200 }
    );
  }

  // --- Flow normal ---
  try {
    const STRIPE_KEY = process.env.STRIPE_SECRET_KEY?.trim();
    if (!STRIPE_KEY || !STRIPE_KEY.startsWith('sk_')) {
      return jsonWithCors(req, { ok: false, error: 'Missing STRIPE_SECRET_KEY' }, { status: 500 });
    }
    if (!email) {
      return jsonWithCors(req, { ok: false, error: 'Missing email' }, { status: 400 });
    }

    // return_url par priorité:
    // 1) body.returnUrl
    // 2) env RETURN_URL_DEFAULT
    // 3) construit via SHOP_DOMAIN
    // 4) fallback dur: ancien URL Shopify
    const defaultFromEnv = (process.env.RETURN_URL_DEFAULT || '').trim();
    const fromShopDomain = process.env.SHOP_DOMAIN
      ? `https://${process.env.SHOP_DOMAIN}/pages/mon-compte-formateur`
      : '';
    const finalReturnUrl =
      (returnUrl && returnUrl.trim()) ||
      defaultFromEnv ||
      fromShopDomain ||
      'https://tqiccz-96.myshopify.com/pages/mon-compte-formateur';

    const stripe = new Stripe(STRIPE_KEY, { apiVersion: '2024-06-20' });

    // On retrouve le client Stripe via son email (le plus simple/fiable ici)
    const { data } = await stripe.customers.list({ email, limit: 1 });
    const customer = data[0];
    if (!customer) {
      return jsonWithCors(req, { ok: false, error: 'Customer not found' }, { status: 404 });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customer.id,
      return_url: finalReturnUrl,
    });

    return jsonWithCors(req, { ok: true, url: session.url }, { status: 200 });
  } catch (e: any) {
    console.error('[Stripe][portal] error:', e?.message || e);
    return jsonWithCors(req, { ok: false, error: e?.message || 'portal_failed' }, { status: 500 });
  }
}
