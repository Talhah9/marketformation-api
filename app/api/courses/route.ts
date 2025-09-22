// app/api/courses/route.ts
// Crée un produit "Course" (vendor = email) + liste les courses.
// Vérifie l'abonnement Stripe + applique le quota Starter (3 / mois).
// Champs produits: image de couverture + métachamps mf.owner_email / mf.owner_id / mf.pdf_url.
// Ajoute à une collection par handle (custom/smart).
// Toutes les réponses passent par jsonWithCors (CORS via ton util).

import { handleOptions, jsonWithCors } from '@/app/api/_lib/cors';
import stripe from '@/lib/stripe';
import type Stripe from 'stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* ===== ENV requis =====
  SHOPIFY_STORE_DOMAIN             ex: tqiccz-96.myshopify.com
  SHOPIFY_ADMIN_API_ACCESS_TOKEN   shpat_***
  SHOPIFY_API_VERSION              ex: 2025-07 (défaut)
  STRIPE_SECRET_KEY (ou STRIPE_SECRET_KEY_LIVE / STRIPE_LIVE_SECRET)
  (facultatif)
  STRIPE_PRICE_STARTER
  STRIPE_PRICE_PRO
  STRIPE_PRICE_BUSINESS
*/

const STORE = process.env.SHOPIFY_STORE_DOMAIN!;
const TOKEN = process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN!;
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-07';

// Check Stripe env — on n'utilise pas STRIPE_KEY directement mais on valide la config
const STRIPE_KEY =
  process.env.STRIPE_SECRET_KEY ||
  process.env.STRIPE_SECRET_KEY_LIVE ||
  process.env.STRIPE_LIVE_SECRET ||
  '';

type PlanKey = 'starter' | 'pro' | 'business' | null;

type CreateCourseBody = {
  // champs “officiels”
  title?: string;
  description?: string;
  collectionHandle?: string;
  coverUrl?: string;
  pdfUrl?: string;
  price?: number; // en centimes (par défaut 1990 => 19,90 €)
  customerEmail?: string | null;
  customerId?: number | string | null;
  stripeCustomerId?: string | null;

  // champs “compat” (depuis ton front)
  email?: string | null;
  shopifyCustomerId?: number | string | null;
  imageUrl?: string;
  image_url?: string;
  pdf_url?: string;
  collection_handle?: string;
};

// ===== Utils =====
function ym(d = new Date()) {
  return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0');
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

// ===== Clients Shopify =====
async function shopifyFindCustomerIdByEmail(email: string): Promise<number | null> {
  if (!email) return null;
  const r = await shopifyFetch(`/customers/search.json?query=${encodeURIComponent(`email:"${email}"`)}`);
  return r.ok ? (r.json?.customers?.[0]?.id ?? null) : null;
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
  return r.json?.customer?.id ?? null;
}
async function shopifyGetCustomerEmailById(id: number | string): Promise<string | null> {
  const r = await shopifyFetch(`/customers/${id}.json`);
  return r.ok ? (r.json?.customer?.email ?? null) : null;
}

// ===== Quota (Customer metafield: mfapp.published_YYYYMM = "YYYYMM:count") =====
const NS = 'mfapp';
const KEY_QUOTA = 'published_YYYYMM';

async function getQuotaMetafield(customerId: number | string) {
  const r = await shopifyFetch(`/customers/${customerId}/metafields.json`);
  if (!r.ok) return { mf: null, count: 0, currentYM: ym() };

  const mf = (r.json?.metafields || []).find((m: any) => m.namespace === NS && m.key === KEY_QUOTA);
  const currentYM = ym();

  if (!mf?.value) return { mf: null, count: 0, currentYM };

  const raw = String(mf.value);
  if (raw.includes(':')) {
    const [ymKey, cnt] = raw.split(':');
    return { mf, count: ymKey === currentYM ? Number(cnt || 0) : 0, currentYM };
  }
  // ancien format numérique
  return { mf, count: Number(mf.value || 0), currentYM };
}

async function setQuotaMetafield(customerId: number | string, value: string, mfId?: number | string) {
  const body = JSON.stringify({
    metafield: {
      namespace: NS,
      key: KEY_QUOTA,
      type: 'single_line_text_field',
      value,
      ...(mfId ? { id: mfId } : { owner_resource: 'customer', owner_id: customerId }),
    },
  });
  const r = mfId
    ? await shopifyFetch(`/metafields/${mfId}.json`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body })
    : await shopifyFetch(`/metafields.json`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  return r.ok;
}

async function enforceQuotaOrThrow(customerId: number | string, planKey: Exclude<PlanKey, null>) {
  // Pro/Business → illimité
  if (planKey !== 'starter') return;

  const { mf, count, currentYM } = await getQuotaMetafield(customerId);
  if (count >= 3) {
    const err: any = new Error('quota_reached');
    err.httpStatus = 402;
    throw err;
  }
  const next = `${currentYM}:${count + 1}`;
  await setQuotaMetafield(customerId, next, mf?.id);
}

// ===== Collections =====
async function findCollectionIdByHandle(handle: string): Promise<number | null> {
  // custom collections
  let r = await shopifyFetch(`/custom_collections.json?limit=250`);
  if (r.ok) {
    const arr = r.json?.custom_collections || [];
    const found = arr.find((c: any) => c.handle === handle);
    if (found?.id) return found.id;
  }
  // smart collections
  r = await shopifyFetch(`/smart_collections.json?limit=250`);
  if (r.ok) {
    const arr = r.json?.smart_collections || [];
    const found = arr.find((c: any) => c.handle === handle);
    if (found?.id) return found.id;
  }
  // fallback global
  r = await shopifyFetch(`/collections.json?limit=250`);
  if (r.ok) {
    const arr = r.json?.collections || [];
    const found = arr.find((c: any) => c.handle === handle);
    if (found?.id) return found.id;
  }
  return null;
}

// ===== Stripe helpers =====
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

    // On veut voir Publiés ET Brouillons → on agrège active + draft (archived optionnel)
    const statuses: Array<'active' | 'draft'> = ['active', 'draft'];

    const results: any[] = [];
    for (const st of statuses) {
      let path = `/products.json?limit=${limit}&status=${st}&fields=id,title,handle,images,vendor,tags,created_at`;
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
      results.push(...(resp.json?.products || []));
    }

    // sécurité: on garde uniquement ceux taggés mf_trainer
    const filtered = results.filter((p: any) =>
      (p.tags || '')
        .split(',')
        .map((t: string) => t.trim().toLowerCase())
        .includes('mf_trainer')
    );

    // dédup par id (si un produit sort des deux appels)
    const dedupMap = new Map<number, any>();
    for (const p of filtered) dedupMap.set(p.id, p);

    const items = Array.from(dedupMap.values()).map((p: any) => ({
      id: p.id,
      title: p.title,
      handle: p.handle,
      coverUrl: p.images?.[0]?.src || null,
      vendor: p.vendor,
      tags: p.tags,
      createdAt: p.created_at,
      url: p.handle ? `https://${STORE}/products/${p.handle}` : null,
      // hint UI: publié si présent dans "active", sinon brouillon
      published: true, // défaut, corrigé ci-dessous via heuristique
    }));

    // Heuristique “published”: si on n'a pas l'info de status par item, on considère:
    // - actif => publié ; draft => brouillon. On reconstruit depuis la liste brute.
    const byIdStatus = new Map<number, 'active' | 'draft'>();
    for (const st of statuses) {
      let path = `/products.json?limit=${limit}&status=${st}&fields=id`;
      if (email) path += `&vendor=${encodeURIComponent(email)}`;
      const resp = await shopifyFetch(path);
      if (resp.ok) {
        for (const p of resp.json?.products || []) byIdStatus.set(p.id, st);
      }
    }
    items.forEach(it => { it.published = (byIdStatus.get(it.id) === 'active'); });

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
    if (!STORE || !TOKEN) {
      return jsonWithCors(req, { ok: false, error: 'server_misconfigured' }, { status: 500 });
    }
    if (!STRIPE_KEY) {
      return jsonWithCors(req, { ok: false, error: 'stripe_secret_missing' }, { status: 500 });
    }

    const body = (await req.json()) as CreateCourseBody;

    // ==== Compat des champs envoyés par le front ====
    const title        = (body.title || '').trim();
    const description  = (body.description || '').trim();
    const collectionHandle = body.collectionHandle || body.collection_handle || undefined;
    const coverUrl     = body.coverUrl || body.imageUrl || body.image_url || undefined;
    const pdfUrl       = body.pdfUrl   || body.pdf_url   || undefined;
    const priceCents   = typeof body.price === 'number' ? body.price : 1990; // default 19,90 €

    // Email / ID client : on accepte customerEmail || email ; customerId || shopifyCustomerId
    let customerEmail = (body.customerEmail || body.email || '' ).trim();
    let incomingCustomerId = body.customerId ?? body.shopifyCustomerId ?? null;

    if (!title || !description) {
      return jsonWithCors(req, { ok: false, error: 'missing_fields' }, { status: 400 });
    }

    // 0) Résoudre l'email si absent mais ID fourni
    if (!customerEmail && (incomingCustomerId !== null && incomingCustomerId !== undefined)) {
      const e = await shopifyGetCustomerEmailById(incomingCustomerId as number | string);
      if (e) customerEmail = e;
    }
    if (!customerEmail) {
      return jsonWithCors(req, { ok: false, error: 'email_required' }, { status: 400 });
    }

    // 1) ID client Shopify (pour quota)
    let resolvedCustomerId: number | null =
      (incomingCustomerId !== null && incomingCustomerId !== undefined)
        ? Number(incomingCustomerId)
        : null;

    if (!resolvedCustomerId || Number.isNaN(resolvedCustomerId)) {
      resolvedCustomerId = await shopifyEnsureCustomerByEmail(customerEmail);
    }
    if (!resolvedCustomerId) {
      return jsonWithCors(req, { ok: false, error: 'shopify_customer_not_found', email: customerEmail }, { status: 400 });
    }

    // 2) Vérifier l'abonnement Stripe
    let stripeCustomer: Stripe.Customer | null = null;

    if (body.stripeCustomerId) {
      try {
        const c = await stripe.customers.retrieve(body.stripeCustomerId);
        if (!('deleted' in c) || !c.deleted) {
          stripeCustomer = c as Stripe.Customer;
        }
      } catch {
        // ignore: on tentera la recherche par email
      }
    }

    if (!stripeCustomer && customerEmail) {
      const list = await stripe.customers.list({ email: customerEmail, limit: 1 });
      stripeCustomer = list.data[0] || null;
    }

    if (!stripeCustomer) {
      return jsonWithCors(req, { ok: false, error: 'subscription_required' }, { status: 402 });
    }

    const subs = await stripe.subscriptions.list({
      customer: stripeCustomer.id,
      status: 'all',
      expand: ['data.items.data.price'],
      limit: 10,
    });

    const active = subs.data.find(s =>
      ['active', 'trialing', 'past_due', 'unpaid'].includes(s.status)
    );

    if (!active) {
      return jsonWithCors(req, { ok: false, error: 'subscription_required' }, { status: 402 });
    }

    const priceObj = active.items.data[0]?.price as Stripe.Price | undefined;
    const priceId = priceObj?.id ?? null;

    let planKey: PlanKey = mapPriceId(priceId);
    if (!planKey && priceObj) planKey = inferPlanKey(priceObj);
    if (!planKey && (active as any).metadata?.plan_from_price) {
      planKey = mapPriceId((active as any).metadata.plan_from_price);
    }
    if (!planKey) {
      return jsonWithCors(req, { ok: false, error: 'plan_unmapped' }, { status: 402 });
    }

    // 3) Quota Starter (3/mois) — Pro/Business illimité
    try {
      await enforceQuotaOrThrow(resolvedCustomerId, planKey as Exclude<PlanKey, null>);
    } catch (err: any) {
      const msg = err?.message || 'quota_error';
      const sc = err?.httpStatus || 402;
      return jsonWithCors(req, { ok: false, error: msg }, { status: sc });
    }

    // 4) Création du produit (status: active par défaut)
    const variantPrice = (priceCents / 100).toFixed(2);
    const productPayload = {
      product: {
        title,
        body_html: description,
        status: 'active',
        tags: 'mf_trainer',
        vendor: customerEmail,              // utilisé pour le filtrage en GET
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

    // 5) Image (post-création)
    if (productId && coverUrl) {
      const img = await shopifyFetch(`/products/${productId}/images.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: { src: coverUrl } }),
      });
      if (!img.ok) console.warn('[courses] add image failed', img.status, img.text);
    }

    // 6) Metafields (owner_email, owner_id, pdf_url)
    if (productId) {
      // owner_email
      const mf1 = await shopifyFetch(`/products/${productId}/metafields.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metafield: { namespace: 'mf', key: 'owner_email', type: 'single_line_text_field', value: customerEmail },
        }),
      });
      if (!mf1.ok) console.warn('[courses] owner_email metafield failed', mf1.status, mf1.text);

      // owner_id
      const mf2 = await shopifyFetch(`/products/${productId}/metafields.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metafield: { namespace: 'mf', key: 'owner_id', type: 'number_integer', value: String(resolvedCustomerId) },
        }),
      });
      if (!mf2.ok) console.warn('[courses] owner_id metafield failed', mf2.status, mf2.text);

      // pdf_url
      if (pdfUrl) {
        const mf3 = await shopifyFetch(`/products/${productId}/metafields.json`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            metafield: { namespace: 'mf', key: 'pdf_url', type: 'single_line_text_field', value: pdfUrl },
          }),
        });
        if (!mf3.ok) console.warn('[courses] pdf_url metafield failed', mf3.status, mf3.text);
      }
    }

    // 7) Ajout à la collection (handle custom/smart)
    if (productId && collectionHandle) {
      const collId = await findCollectionIdByHandle(collectionHandle);
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

    const adminUrl = productId ? `https://${STORE}/admin/products/${productId}` : undefined;
    const onlineUrl = handle ? `https://${STORE}/products/${handle}` : undefined;
    return jsonWithCors(req, { ok: true, productId, handle, url: onlineUrl, adminUrl });
  } catch (e: any) {
    console.error('[courses][POST] error', e?.message || e);
    return jsonWithCors(req, { ok: false, error: e?.message || 'courses_failed' }, { status: e?.httpStatus || 500 });
  }
}
