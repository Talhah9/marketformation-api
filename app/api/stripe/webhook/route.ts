// Webhook Stripe (Platform + Connect) → met à jour le plan/statut côté Shopify Customer Metafields
// Garde la vérification double secret déjà présente chez toi.
// Requiert env (PROD):
//   STRIPE_SECRET_KEY=sk_live_...
//   STRIPE_WEBHOOK_SECRET_PLATFORM=whsec_...
//   STRIPE_WEBHOOK_SECRET_CONNECT=whsec_...   (si tu déclares un endpoint pour les events Connect)
//   SHOPIFY_STORE_DOMAIN=tqiccz-96.myshopify.com
//   SHOPIFY_ADMIN_API_ACCESS_TOKEN=shpat_...
//   SHOPIFY_API_VERSION=2025-07
//   STRIPE_PRICE_STARTER=price_1S75P9AFTm9a9DAT1nAv42vk
//   STRIPE_PRICE_PRO=price_1S75PbAFTm9a9DATEH8hzcpM
//   STRIPE_PRICE_BUSINESS=price_1S75PyAFTm9a9DATwXsbdHtx

import { NextRequest, NextResponse } from 'next/server';
import StripeLib from 'stripe';
import stripeDefault from '@/lib/stripe'; // ton instance existante (Platform)

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Stripe = StripeLib; // alias de type

const API_VERSION = '2024-06-20';

// ========= Helpers Stripe =========

// Si event vient d’un compte Connect (event.account défini), on crée un client "scopé" sur ce compte :
function stripeForAccount(accountId?: string | null) {
  if (!accountId) return stripeDefault as unknown as StripeLib;
  return new StripeLib(process.env.STRIPE_SECRET_KEY!, { apiVersion: API_VERSION, stripeAccount: accountId });
}

function tryConstructEvent(buf: Buffer, sig: string, secret?: string) {
  if (!secret) throw new Error('no secret');
  return stripeDefault.webhooks.constructEvent(buf, sig, secret);
}

// ========= Shopify helpers =========

const STORE = process.env.SHOPIFY_STORE_DOMAIN!;
const TOKEN = process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN!;
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-07';

async function shopifyFetch(path: string, init?: RequestInit) {
  const url = `https://${STORE}/admin/api/${SHOPIFY_API_VERSION}${path}`;
  const r = await fetch(url, {
    ...init,
    headers: {
      'X-Shopify-Access-Token': TOKEN,
      'Accept': 'application/json',
      ...(init?.headers || {}),
    },
    cache: 'no-store',
  });
  const text = await r.text();
  let json: any = undefined;
  try { json = text ? JSON.parse(text) : undefined; } catch {}
  return { ok: r.ok, status: r.status, json, text, statusText: r.statusText };
}

async function shopifyFindCustomerIdByEmail(email: string): Promise<number | null> {
  if (!email) return null;
  const resp = await shopifyFetch(`/customers/search.json?query=${encodeURIComponent(`email:"${email}"`)}`);
  if (!resp.ok) return null;
  const id = resp.json?.customers?.[0]?.id;
  return typeof id === 'number' ? id : null;
}

async function shopifyEnsureCustomerByEmail(email: string): Promise<number | null> {
  const found = await shopifyFindCustomerIdByEmail(email);
  if (found) return found;

  const resp = await shopifyFetch(`/customers.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customer: { email, tags: 'mf_trainer' } }),
  });
  if (!resp.ok) {
    console.warn('[webhook] create customer failed', resp.status, resp.text || resp.statusText);
    return null;
  }
  const id = resp.json?.customer?.id;
  return typeof id === 'number' ? id : null;
}

type MetafieldType = 'single_line_text_field' | 'number_integer' | 'date_time';

async function upsertCustomerMetafield(
  customerId: number,
  namespace: string,
  key: string,
  type: MetafieldType,
  value: string
) {
  const list = await shopifyFetch(`/customers/${customerId}/metafields.json?namespace=${encodeURIComponent(namespace)}`);
  const existing = (list.json?.metafields || []).find((m: any) => m.key === key);

  if (existing?.id) {
    const upd = await shopifyFetch(`/metafields/${existing.id}.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metafield: { id: existing.id, type, value } }),
    });
    if (!upd.ok) console.warn('[webhook] metafield update failed', upd.status, upd.text);
    return upd.ok;
  }

  const crt = await shopifyFetch(`/customers/${customerId}/metafields.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ metafield: { namespace, key, type, value } }),
  });
  if (!crt.ok) console.warn('[webhook] metafield create failed', crt.status, crt.text);
  return crt.ok;
}

// ========= Plan mapping =========

type PlanKey = 'starter' | 'pro' | 'business' | null;

function mapPriceId(priceId?: string | null): PlanKey {
  if (!priceId) return null;
  const map: Record<string, PlanKey> = {
    [process.env.STRIPE_PRICE_STARTER ?? '']: 'starter',
    [process.env.STRIPE_PRICE_PRO ?? '']: 'pro',
    [process.env.STRIPE_PRICE_BUSINESS ?? '']: 'business',
  };
  return map[priceId] ?? null;
}

function inferPlanKeyFromPrice(p: StripeLib.Price): PlanKey {
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

async function resolvePlanKey(sub: StripeLib.Subscription, client: StripeLib): Promise<{ planKey: PlanKey; priceId: string | null }> {
  const price = sub.items.data[0]?.price as StripeLib.Price | undefined;
  const priceId = price?.id ?? null;

  let planKey: PlanKey = mapPriceId(priceId);
  if (!planKey && sub.metadata?.plan_from_price) planKey = mapPriceId(sub.metadata.plan_from_price);
  if (!planKey && price) planKey = inferPlanKeyFromPrice(price);

  if (!planKey && priceId) {
    const pr = await client.prices.retrieve(priceId, { expand: ['product'] });
    planKey = inferPlanKeyFromPrice(pr);
  }
  return { planKey, priceId };
}

// ========= Core updater =========

async function updateShopifyFromSubscription(sub: StripeLib.Subscription, client: StripeLib) {
  try {
    const stripeCustomerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
    const sc = await client.customers.retrieve(stripeCustomerId);
    const email =
      (typeof sc !== 'string' && 'email' in sc ? (sc as StripeLib.Customer).email : null) || null;
    if (!email) { console.warn('[webhook] no email on stripe customer'); return; }

    const customerId = await shopifyEnsureCustomerByEmail(email);
    if (!customerId) { console.warn('[webhook] shopifyEnsureCustomerByEmail failed for', email); return; }

    const { planKey, priceId } = await resolvePlanKey(sub, client);
    const status = sub.status;
    const cpeMs = (sub.current_period_end || 0) * 1000;
    const nowIso = new Date().toISOString();

    await upsertCustomerMetafield(customerId, 'mfapp', 'sub_status', 'single_line_text_field', status);
    await upsertCustomerMetafield(customerId, 'mfapp', 'sub_plan_key', 'single_line_text_field', String(planKey || ''));
    await upsertCustomerMetafield(customerId, 'mfapp', 'sub_price_id', 'single_line_text_field', String(priceId || ''));
    if (cpeMs > 0) {
      await upsertCustomerMetafield(customerId, 'mfapp', 'sub_current_period_end', 'number_integer', String(cpeMs));
    }
    await upsertCustomerMetafield(customerId, 'mfapp', 'sub_updated_at', 'date_time', nowIso);

    console.log('[webhook] metafields updated', { email, status, planKey, priceId, cpeMs });
  } catch (e: any) {
    console.error('[webhook] updateShopifyFromSubscription error', e?.message || e);
  }
}

// ========= Handler =========

export async function POST(req: NextRequest) {
  try {
    const sig = req.headers.get('stripe-signature')!;
    const buf = Buffer.from(await req.arrayBuffer());

    // Double secret (comme ton fichier) + fallback éventuel STRIPE_WEBHOOK_SECRET
    const secrets = [
      process.env.STRIPE_WEBHOOK_SECRET_PLATFORM,
      process.env.STRIPE_WEBHOOK_SECRET_CONNECT,
      process.env.STRIPE_WEBHOOK_SECRET, // facultatif
    ].filter(Boolean) as string[];

    let event: StripeLib.Event | null = null;
    let lastErr: any = null;

    for (const sec of secrets) {
      try {
        event = tryConstructEvent(buf, sig, sec);
        break;
      } catch (err) {
        lastErr = err;
        continue;
      }
    }
    if (!event) {
      return NextResponse.json({ error: 'Webhook signature failed', detail: String(lastErr?.message || lastErr) }, { status: 400 });
    }

    // Client Stripe : Platform ou Connect
    const client = stripeForAccount((event as any).account);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as StripeLib.Checkout.Session;
        if (session.mode === 'subscription' && session.subscription) {
          const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
          const sub = await client.subscriptions.retrieve(subId, { expand: ['items.data.price'] });
          await updateShopifyFromSubscription(sub, client);
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as StripeLib.Subscription;
        await updateShopifyFromSubscription(sub, client);
        break;
      }

      case 'invoice.payment_succeeded':
      case 'invoice.payment_failed': {
        const inv = event.data.object as StripeLib.Invoice;
        if (inv.subscription) {
          const subId = typeof inv.subscription === 'string' ? inv.subscription : inv.subscription?.id;
          if (subId) {
            const sub = await client.subscriptions.retrieve(subId, { expand: ['items.data.price'] });
            await updateShopifyFromSubscription(sub, client);
          }
        }
        break;
      }

      // (ex: Connect) — à garder si tu veux traquer l'état de comptes connectés
      case 'account.updated': {
        // TODO si besoin: tenir à jour charges_enabled pour un formateur Connect
        break;
      }

      default:
        // console.log('[webhook] unhandled', event.type);
        break;
    }

    return NextResponse.json({ received: true });
  } catch (e: any) {
    console.error('[webhook] error', e?.message || e);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
