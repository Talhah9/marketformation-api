// app/api/courses/route.ts
// Crée un produit "Course" (vendor = email) + liste les courses.
// Quota Starter (3 / mois) basé sur le métachamp mfapp.published_YYYYMM.
// Retourne aussi { plan, quota: { limit, used, remaining } } pour l'abonnement.

import { handleOptions, jsonWithCors } from '@/app/api/_lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* ===== Utils ===== */
function ym(d = new Date()) {
  return String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, '0');
}

function getAdminToken() {
  return (
    process.env.SHOP_ADMIN_TOKEN ||
    process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN ||
    process.env.ADMIN_TOKEN ||
    ''
  );
}

async function shopifyFetch(path: string, init?: RequestInit & { json?: any }) {
  const domain = process.env.SHOP_DOMAIN;
  if (!domain) throw new Error('Missing env SHOP_DOMAIN');

  const base = `https://${domain}/admin/api/2024-07`;
  const headers: Record<string, string> = {
    'X-Shopify-Access-Token': getAdminToken(),
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  const res = await fetch(base + path, {
    method: init?.method || (init?.json ? 'POST' : 'GET'),
    headers,
    body: init?.json ? JSON.stringify(init.json) : undefined,
    cache: 'no-store',
  });

  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {}

  return { ok: res.ok, status: res.status, json, text };
}

/* ===== Labels thématiques (mêmes clés que côté front) ===== */
const THEME_LABELS: Record<string, string> = {
  'tech-ia': 'Tech & IA',
  'business-entrepreneuriat': 'Business & Entrepreneuriat',
  'carriere-competences': 'Carrière & Compétences',
  'finance-investissement': 'Finance & Investissement',
  'creativite-design': 'Créativité & Design',
  'developpement-personnel-bien-etre': 'Développement perso & Bien-être',
};

/* ===== Métachamps ===== */
async function getProductMetafieldValue(
  productId: number,
  namespace: string,
  key: string,
) {
  const r = await shopifyFetch(`/products/${productId}/metafields.json?limit=250`);
  if (!r.ok) return null;
  const arr = (r.json as any)?.metafields || [];
  const mf = arr.find((m: any) => m?.namespace === namespace && m?.key === key);
  return mf?.value ?? null;
}

async function upsertProductMetafield(
  productId: number,
  namespace: string,
  key: string,
  type: string,
  value: string,
) {
  return shopifyFetch(`/metafields.json`, {
    json: {
      metafield: {
        namespace,
        key,
        type,
        value,
        owner_resource: 'product',
        owner_id: productId,
      },
    },
  });
}

/* ===== Collection resolve ===== */
async function resolveCollectionId(handleOrId?: string | number): Promise<number | null> {
  if (!handleOrId) return null;

  const num = Number(handleOrId);
  if (!Number.isNaN(num) && String(num) === String(handleOrId)) return num;

  const handle = String(handleOrId).trim();

  let r = await shopifyFetch(
    `/custom_collections.json?handle=${encodeURIComponent(handle)}&limit=1`,
  );
  if (r.ok && (r.json as any)?.custom_collections?.[0]?.id)
    return Number((r.json as any).custom_collections[0].id);

  r = await shopifyFetch(
    `/smart_collections.json?handle=${encodeURIComponent(handle)}&limit=1`,
  );
  if (r.ok && (r.json as any)?.smart_collections?.[0]?.id)
    return Number((r.json as any).smart_collections[0].id);

  return null;
}

/* ===== Subscription plan ===== */
async function getPlanFromInternalSubscription(req: Request, email: string) {
  try {
    const u = new URL(req.url);
    const base = `${u.protocol}//${u.host}`;

    const r = await fetch(`${base}/api/subscription`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
      cache: 'no-store',
    });

    const data = await r.json().catch(() => ({}));
    const raw = (data?.planKey || data?.plan || data?.tier || '').toString();

    if (/business/i.test(raw)) return 'Business';
    if (/pro/i.test(raw)) return 'Pro';
    if (/starter/i.test(raw)) return 'Starter';
    return 'Unknown';
  } catch {
    return 'Unknown';
  }
}

/* ===== Compte des publications Starter ===== */
async function countPublishedThisMonthByMetafield(email: string) {
  // ici on garde le vendor pour le quota (car on crée les produits avec vendor = email)
  const vendor = encodeURIComponent(email);
  const r = await shopifyFetch(`/products.json?vendor=${vendor}&limit=250`);
  if (!r.ok) return 0;

  const products = (r.json as any)?.products || [];
  const bucket = ym();

  let count = 0;
  for (const p of products) {
    const val = await getProductMetafieldValue(p.id, 'mfapp', 'published_YYYYMM');
    if (val === bucket) count++;
  }
  return count;
}

/* ===== OPTIONS (CORS) ===== */
export async function OPTIONS(req: Request) {
  return handleOptions(req);
}

/* =====================================================================
   GET /api/courses
   → Liste les formations du formateur (filtrées par mkt.owner_email)
     + renvoie le quota Starter
===================================================================== */
export async function GET(req: Request) {
  try {
    if (!process.env.SHOP_DOMAIN || !getAdminToken()) {
      return jsonWithCors(
        req,
        { ok: false, error: 'Missing SHOP_DOMAIN or Admin token' },
        { status: 500 },
      );
    }

    const url = new URL(req.url);
    const email = (url.searchParams.get('email') || '').trim();

    // 🔥 On ne filtre plus par vendor ici, on récupère les produits et on filtre via mkt.owner_email
    const r = await shopifyFetch(`/products.json?limit=250`);
    if (!r.ok) {
      return jsonWithCors(
        req,
        { ok: false, error: `Shopify ${r.status}`, detail: r.text },
        { status: r.status },
      );
    }

    const allProducts = (r.json as any)?.products || [];

    const products: any[] = [];
    for (const p of allProducts) {
      const ownerEmail = await getProductMetafieldValue(p.id, 'mkt', 'owner_email');
      if (!email || (ownerEmail && ownerEmail.toString().trim() === email)) {
        products.push(p);
      }
    }

    const items = await Promise.all(
      products.map(async (p: any) => {
        // thématique mfapp.theme (handle)
        const themeHandleRaw = (await getProductMetafieldValue(p.id, 'mfapp', 'theme')) || '';
        const mf_theme = String(themeHandleRaw || '').trim();
        const theme_label =
          mf_theme && THEME_LABELS[mf_theme] ? THEME_LABELS[mf_theme] : '';

        return {
          id: p.id,
          title: p.title,
          coverUrl: p.image?.src || '',
          image_url: p.image?.src || '',
          published: !!p.published_at,
          createdAt: p.created_at,
          mf_theme,
          theme_label,
        };
      }),
    );

    /* ==== QUOTA pour abonnement ==== */
    let plan: 'Starter' | 'Pro' | 'Business' | 'Unknown' = 'Unknown';
    let quota: any = null;

    if (email) {
      plan = await getPlanFromInternalSubscription(req, email);

      if (plan === 'Starter') {
        const used = await countPublishedThisMonthByMetafield(email);
        quota = {
          plan: 'Starter',
          limit: 3,
          used,
          remaining: Math.max(0, 3 - used),
        };
      } else {
        quota = {
          plan,
          limit: null,
          used: null,
          remaining: null,
        };
      }
    }

    return jsonWithCors(req, {
      ok: true,
      items,
      plan,
      quota,
    });
  } catch (e: any) {
    return jsonWithCors(
      req,
      { ok: false, error: e?.message || 'list_failed' },
      { status: 500 },
    );
  }
}

/* =====================================================================
   POST /api/courses
   → Création d’un produit (Course) + quota Starter
===================================================================== */
export async function POST(req: Request) {
  try {
    if (!process.env.SHOP_DOMAIN || !getAdminToken()) {
      return jsonWithCors(
        req,
        { ok: false, error: 'Missing SHOP_DOMAIN or Admin token' },
        { status: 500 },
      );
    }

    const url = new URL(req.url);
    const bypass = url.searchParams.get('bypassQuota') === '1';

    const body = await req.json().catch(() => ({} as any));
    const {
      email,
      shopifyCustomerId,
      title,
      description,
      imageUrl,
      pdfUrl: pdfUrlRaw,
      pdf_url,
      status = 'active',
      collectionId,
      collectionHandle,
      collectionHandleOrId,
      // thématique potentiellement envoyée par le front
      theme,
      themeHandle,
      mf_theme,
    } = body || {};

    const pdfUrl = String(pdfUrlRaw || pdf_url || '').trim();

    if (!email || !title || !imageUrl || !pdfUrl) {
      return jsonWithCors(
        req,
        { ok: false, error: 'missing fields' },
        { status: 400 },
      );
    }

    if (!/^https?:\/\//i.test(pdfUrl)) {
      return jsonWithCors(
        req,
        { ok: false, error: 'pdfUrl must be https URL' },
        { status: 400 },
      );
    }

    const plan = await getPlanFromInternalSubscription(req, email);

    if (!bypass && plan === 'Starter') {
      const used = await countPublishedThisMonthByMetafield(email);
      if (used >= 3) {
        return jsonWithCors(
          req,
          {
            ok: false,
            error: 'quota_reached',
            detail: 'Starter plan allows 3 published courses per month',
          },
          { status: 403 },
        );
      }
    }

    /* Création produit */
    const productPayload = {
      product: {
        title,
        body_html: description ? `<p>${description}</p>` : '',
        vendor: email,
        images: imageUrl ? [{ src: imageUrl }] : [],
        tags: ['mkt-course'],
        status,
      },
    };

    const createRes = await shopifyFetch(`/products.json`, { json: productPayload });
    if (!createRes.ok) {
      return jsonWithCors(
        req,
        { ok: false, error: `Shopify ${createRes.status}`, detail: createRes.text },
        { status: createRes.status },
      );
    }

    const created = (createRes.json as any)?.product;
    if (!created?.id) {
      return jsonWithCors(
        req,
        { ok: false, error: 'create_failed_no_id' },
        { status: 500 },
      );
    }

    /* Métachamps mkt */
    await upsertProductMetafield(
      created.id,
      'mkt',
      'owner_email',
      'single_line_text_field',
      email,
    );
    if (shopifyCustomerId) {
      await upsertProductMetafield(
        created.id,
        'mkt',
        'owner_id',
        'single_line_text_field',
        String(shopifyCustomerId),
      );
    }
    await upsertProductMetafield(
      created.id,
      'mkt',
      'pdf_url',
      'url',
      pdfUrl,
    );

    /* Marquage quota */
    if (status === 'active') {
      const bucket = ym();
      await upsertProductMetafield(
        created.id,
        'mfapp',
        'published_YYYYMM',
        'single_line_text_field',
        bucket,
      );
    }

    /* Assignation collection + thématique */
    const selector = collectionId ?? collectionHandleOrId ?? collectionHandle;
    let themeHandleFinal =
      (mf_theme || themeHandle || theme || '').toString().trim() || '';

    // Si on n'a pas de thématique explicite, on récupère le handle de collection si c'est une string non numérique
    if (!themeHandleFinal && selector && typeof selector === 'string') {
      const isNumeric = /^[0-9]+$/.test(selector);
      if (!isNumeric) {
        themeHandleFinal = selector.trim();
      }
    }

    if (selector) {
      const cid = await resolveCollectionId(selector);
      if (cid) {
        await shopifyFetch(`/collects.json`, {
          json: { collect: { product_id: created.id, collection_id: cid } },
        });
      }
    }

    // 🔥 Persistance de la thématique pour la page publique
    if (themeHandleFinal) {
      await upsertProductMetafield(
        created.id,
        'mfapp',
        'theme',
        'single_line_text_field',
        themeHandleFinal,
      );
    }

    return jsonWithCors(req, {
      ok: true,
      id: created.id,
      handle: created.handle,
      admin_url: `https://${process.env.SHOP_DOMAIN}/admin/products/${created.id}`,
    });
  } catch (e: any) {
    return jsonWithCors(
      req,
      { ok: false, error: e?.message || 'create_failed' },
      { status: 500 },
    );
  }
}
