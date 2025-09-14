// app/api/stripe/portal/route.ts
import Stripe from 'stripe';
import { handleOptions, jsonWithCors } from '@/app/api/_lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });

// Pour résoudre l'email à partir d'un customerId Shopify si besoin
const STORE = process.env.SHOPIFY_STORE_DOMAIN!;
const TOKEN = process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN!;
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-07';

async function getShopifyCustomerEmail(id: number | string): Promise<string | null> {
  if (!STORE || !TOKEN) return null;
  const url = `https://${STORE}/admin/api/${API_VERSION}/customers/${id}.json`;
  const r = await fetch(url, { headers: { 'X-Shopify-Access-Token': TOKEN, 'Accept': 'application/json' }, cache: 'no-store' });
  if (!r.ok) return null;
  const j = await r.json();
  return j?.customer?.email ?? null;
}

export async function OPTIONS(req: Request) { return handleOptions(req); }

export async function POST(req: Request) {
  try {
    const { email, shopifyCustomerId, returnUrl } = await req.json().catch(() => ({} as any));

    // 1) Résoudre l'email
    let customerEmail: string | null = email || null;
    if (!customerEmail && shopifyCustomerId) {
      customerEmail = await getShopifyCustomerEmail(shopifyCustomerId);
    }
    if (!customerEmail) {
      return jsonWithCors(req, { ok: false, error: 'no_email' }, { status: 400 });
    }

    // 2) Retrouver le customer Stripe par email
    const list = await stripe.customers.list({ email: customerEmail, limit: 1 });
    const customer = list.data[0];
    if (!customer) {
      return jsonWithCors(req, { ok: false, error: 'no_customer' }, { status: 404 });
    }

    // 3) Créer la session portail
    const fallbackReturnUrl =
      returnUrl ||
      process.env.PORTAL_RETURN_URL ||
      `https://${STORE}/pages/mon-compte-formateur`;

    const session = await stripe.billingPortal.sessions.create({
      customer: customer.id,
      return_url: fallbackReturnUrl,
    });

    return jsonWithCors(req, { ok: true, url: session.url });
  } catch (err: any) {
    const msg = err?.raw?.message || err?.message || 'portal_failed';
    return jsonWithCors(req, { ok: false, error: msg }, { status: 500 });
  }
}
