// Crée un produit "Course" et liste les courses d'un formateur (vendor = email)
// Vérifie l'abonnement Stripe directement (sans appel HTTP interne) + applique le quota
// app/api/courses/route.ts

import { handleOptions, jsonWithCors } from '@/app/api/_lib/cors';
import { assertCanPublish } from '@/lib/gating';
import Stripe from 'stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STORE = process.env.SHOPIFY_STORE_DOMAIN!;                     // ex: tqiccz-96.myshopify.com (sans https)
const TOKEN = process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN!;           // shpat_...
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-07';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });

type CreateCourseBody = {
  title: string;
  description: string;
  collectionHandle?: string;
  coverUrl?: string;
  pdfUrl?: string;
  price?: number;        // en centimes
  customerEmail?: string | null;
  customerId?: number | null;
};

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

function inferPlanKey(p: Stripe.Price): PlanKey {
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

function baseUrlFromReq(req: Request) {
  return (
    process.env.PUBLIC_BASE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : new URL(req.url).origin)
  );
}

async function shopifyFetch(path: string, init?: RequestInit) {
  const url = `https://${STORE}/admin/api/${API_VERSION}${path}`;
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

// --- Helpers Clients Shopify ---

async function shopifyFindCustomerIdByEmail(email: string): Promise<number | null> {
  if (!email) return null;
  const path = `/customers/search.json?query=${encodeURIComponent(`email:"${email}"`)}`;
  const r = await shopifyFetch(path);
  if (!r.ok) return null;
  const id = r.json?.customers?.[0]?.id;
  return typeof id === 'number' ? id : null;
}

async function shopifyEnsureCustomerByEmail(email: string): Promise<number | null> {
  const found = await shopifyFindCustomerIdByEmail(email);
  if (found) return found;

  const r = await shopifyFetch(`/customers.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customer: { email, tags: 'mf_trainer' } }),
  });
  if (!r.ok) {
    console.warn('[courses] create customer failed', r.status, r.text || r.statusText);
    return null;
  }
  const id = r.json?.customer?.id;
  return typeof id === 'number' ? id : null;
}

// Si l'email n'est pas fourni, on peut le retrouver via Shopify ID
async function shopifyGetCustomerEmailById(id: number | string): Promise<string | null> {
  const r = await shopifyFetch(`/customers/${id}.json`);
  return r.ok ? (r.json?.customer?.email ?? null) : null;
}

/* ---------- CORS preflight ---------- */
export async function OPTIONS(req: Request) {
  return handleOptions(req);
}

/* ---------- GET /api/courses?email=... ---------- */
export async function GET(req: Request) {
  try {
    if (!STORE || !TOKEN) {
      return jsonWithCors(req, { ok: false, error: 'server_misconfigured' }, { status: 500 });
    }

    const url = new URL(req.url);
    const email = (url.searchParams.get('email') || '').trim();
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 250);

    let path = `/products.json?limit=${limit}&status=active&fields=id,title,handle,images,vendor,tags,created_at`;
    if (email) path += `&vendor=${encodeURIComponent(email)}`;

    const resp = await shopifyFetch(path);
    if (!resp.ok) {
      return jsonWithCors(req, {
        ok: false,
        error: 'list_failed',
        detail: resp.json?.errors || resp.text || resp.statusText,
        status: resp.status,
      }, { status: 502 });
    }

    const products = resp.json?.products || [];
    const filtered = products.filter((p: any) =>
      (p.tags || '')
        .split(',')
        .map((t: string) => t.trim().toLowerCase())
        .includes('mf_trainer')
    );

    const items = filtered.map((p: any) => ({
      id: p.id,
      title: p.title,
      handle: p.handle,
      coverUrl: p.images?.[0]?.src || null,
      vendor: p.vendor,
      tags: p.tags,
      createdAt: p.created_at,
      url: p.handle ? `https://${STORE}/products/${p.handle}` : null,
    }));

    return jsonWithCors(req, { ok: true, items });
  } catch (e: any) {
    console.error('[courses][GET] error', e?.message || e);
    return jsonWithCors(req, { ok: false, error: e?.message || 'list_failed' }, { status: 500 });
  }
}

/* ---------- POST /api/courses ---------- */
export async function POST(req: Request) {
  try {
    const ct = req.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      return jsonWithCors(req, { ok: false, error: 'content_type_required_json' }, { status: 415 });
    }
    if (!STORE || !TOKEN || !process.env.STRIPE_SECRET_KEY) {
      return jsonWithCors(req, { ok: false, error: 'server_misconfigured' }, { status: 500 });
    }

    const body = (await req.json()) as CreateCourseBody;
    const {
      title, description, collectionHandle, coverUrl, pdfUrl, price,
      customerEmail: emailFromBody, customerId
    } = body || {};

    if (!title || !description) {
      return jsonWithCors(req, { ok: false, error: 'missing_fields' }, { status: 400 });
    }

    // 0) Résoudre email
    let customerEmail = (emailFromBody || '').trim();
    if (!customerEmail && typeof customerId === 'number' && customerId > 0) {
      const e = await shopifyGetCustomerEmailById(customerId);
      if (e) customerEmail = e;
    }
    if (!customerEmail) {
      return jsonWithCors(req, { ok: false, error: 'email_required' }, { status: 400 });
    }

    // 1) Résoudre/Créer un customerId Shopify valide (quota sur Customer)
    let resolvedCustomerId: number | null =
      (typeof customerId === 'number' && customerId > 0) ? customerId : null;

    if (!resolvedCustomerId) {
      resolvedCustomerId = await shopifyEnsureCustomerByEmail(customerEmail);
    }
    if (!resolvedCustomerId) {
      return jsonWithCors(req, { ok: false, error: 'shopify_customer_not_found', email: customerEmail }, { status: 400 });
    }

    // 2) Vérifier l'abonnement Stripe (direct Stripe, pas d'appel HTTP interne)
    //    - retrouve le Customer Stripe par email
    const list = await stripe.customers.list({ email: customerEmail, limit: 1 });
    const stripeCustomer = list.data[0];
    if (!stripeCustomer) {
      return jsonWithCors(req, { ok: false, error: 'subscription_required' }, { status: 402 });
    }

    const subs = await stripe.subscriptions.list({
      customer: stripeCustomer.id,
      status: 'all',
      expand: ['data.items.data.price'],
      limit: 10,
    });
    const active = subs.data.find(s => ['active', 'trialing', 'past_due', 'unpaid'].includes(s.status));
    if (!active) {
      return jsonWithCors(req, { ok: false, error: 'subscription_required' }, { status: 402 });
    }

    const priceObj = active.items.data[0]?.price as Stripe.Price | undefined;
    const priceId = priceObj?.id ?? null;

    let planKey: PlanKey = mapPriceId(priceId);
    if (!planKey && priceObj) planKey = inferPlanKey(priceObj);
    if (!planKey && active.metadata?.plan_from_price) {
      planKey = mapPriceId(active.metadata.plan_from_price);
    }
    if (!planKey) {
      return jsonWithCors(req, { ok: false, error: 'plan_unmapped' }, { status: 402 });
    }

    // 3) Quota (peut renvoyer 402 si dépassé)
    await assertCanPublish(resolvedCustomerId, planKey as Exclude<PlanKey, null>);

    // 4) Ping boutique
    const ping = await shopifyFetch('/shop.json');
    if (!ping.ok) {
      return jsonWithCors(req, {
        ok: false,
        error: 'shop_ping_failed',
        detail: ping.json?.errors || ping.text || ping.statusText,
        status: ping.status,
      }, { status: 502 });
    }

    // 5) Création produit
    const variantPrice = price ? (price / 100).toFixed(2) : '19.90';
    const productPayload = {
      product: {
        title,
        body_html: description,
        status: 'active',
        tags: 'mf_trainer',                        // CSV attendu côté REST
        vendor: customerEmail,                     // pour filtrer en GET
        variants: [{ price: variantPrice }],
      },
    };

    const create = await shopifyFetch('/products.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(productPayload),
    });
    if (!create.ok) {
      return jsonWithCors(req, {
        ok: false,
        error: 'product_create_failed',
        detail: create.json?.errors || create.text || create.statusText,
        status: create.status,
      }, { status: 502 });
    }

    const product = create.json?.product;
    const productId: number | undefined = product?.id;
    const handle: string | undefined = product?.handle;

    // 6) Image (post-création)
    if (productId && coverUrl) {
      const img = await shopifyFetch(`/products/${productId}/images.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: { src: coverUrl } }),
      });
      if (!img.ok) console.warn('[courses] add image failed', img.status, img.text);
    }

    // 7) Metafields owner & pdf
    if (productId) {
      if (customerEmail) {
        const mfOwner = await shopifyFetch(`/products/${productId}/metafields.json`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            metafield: {
              namespace: 'mf',
              key: 'owner_email',
              type: 'single_line_text_field',
              value: customerEmail,
            },
          }),
        });
        if (!mfOwner.ok) console.warn('[courses] owner_email metafield failed', mfOwner.status, mfOwner.text);
      }

      const mfOwnerId = await shopifyFetch(`/products/${productId}/metafields.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metafield: {
            namespace: 'mf',
            key: 'owner_id',
            type: 'number_integer',
            value: String(resolvedCustomerId),
          },
        }),
      });
      if (!mfOwnerId.ok) console.warn('[courses] owner_id metafield failed', mfOwnerId.status, mfOwnerId.text);

      if (pdfUrl) {
        const mfPdf = await shopifyFetch(`/products/${productId}/metafields.json`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            metafield: {
              namespace: 'mf',
              key: 'pdf_url',
              type: 'single_line_text_field',
              value: pdfUrl,
            },
          }),
        });
        if (!mfPdf.ok) console.warn('[courses] pdf_url metafield failed', mfPdf.status, mfPdf.text);
      }
    }

    // 8) Ajout à la collection (optionnel)
    if (productId && collectionHandle) {
      const cc = await shopifyFetch(`/custom_collections.json?handle=${encodeURIComponent(collectionHandle)}`);
      const collId: number | undefined = cc.json?.custom_collections?.[0]?.id;
      if (collId) {
        const collect = await shopifyFetch('/collects.json', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ collect: { product_id: productId, collection_id: collId } }),
        });
        if (!collect.ok) console.warn('[courses] collect failed', collect.status, collect.text);
      } else {
        console.warn(`[courses] collection not found for handle="${collectionHandle}"`);
      }
    }

    const onlineUrl = handle ? `https://${STORE}/products/${handle}` : undefined;
    return jsonWithCors(req, { ok: true, productId, handle, url: onlineUrl });
  } catch (e: any) {
    if (e instanceof Response) return e; // pour un éventuel throw Response depuis assertCanPublish
    console.error('[courses][POST] error', e?.message || e);
    return jsonWithCors(req, { ok: false, error: e?.message || 'courses_failed' }, { status: 500 });
  }
}
