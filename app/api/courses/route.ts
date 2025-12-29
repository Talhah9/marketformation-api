// app/api/courses/route.ts
// Crée un produit "Course" (vendor = email) + liste les courses.
// Quota Starter (3 / mois) basé sur le métachamp mfapp.published_YYYYMM.
// Retourne aussi { plan, quota: { limit, used, remaining } } pour l'abonnement.
//
// ✅ UPDATE (schema public):
// - Support public listing via App Proxy: /apps/mf/courses?handle=XXX&public=1 (ou ?u=XXX)
// - Résout handle -> customerId via tag Shopify: mf_handle:<handle>
// - Résout ensuite email via customerId (pour vendor=email)
// - En public=1: ne renvoie que les cours publiés + pas de quota

import { handleOptions, jsonWithCors } from '@/app/api/_lib/cors';
import { prisma } from '@/lib/prisma';

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

/* ===== Public handle -> customer/email =====
   Stratégie: customer tag "mf_handle:<handle>"
   Exemple: mf_handle:john-doe
*/
async function findCustomerIdByHandle(handle: string): Promise<number | null> {
  const h = String(handle || '').trim();
  if (!h) return null;

  // si on passe directement un ID numérique
  const num = Number(h);
  if (!Number.isNaN(num) && String(num) === h) return num;

  const q = `tag:"mf_handle:${h}"`;
  const r = await shopifyFetch(
    `/customers/search.json?query=${encodeURIComponent(q)}&limit=1`,
  );
  if (!r.ok) return null;

  const customers = (r.json as any)?.customers || [];
  if (!customers[0]?.id) return null;
  return Number(customers[0].id);
}

async function getCustomerEmailById(customerId: number): Promise<string> {
  const r = await shopifyFetch(`/customers/${customerId}.json`);
  const customer = (r.ok && (r.json as any)?.customer) || {};
  return String(customer.email || '').trim();
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
  const r = await shopifyFetch(
    `/products/${productId}/metafields.json?limit=250`,
  );
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
async function resolveCollectionId(
  handleOrId?: string | number,
): Promise<number | null> {
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

/* ===== NEW: sanitize helpers for sync fields ===== */
function cleanStr(v: any, max = 180) {
  return String(v ?? '').trim().slice(0, max);
}
function cleanList(arr: any, maxItems = 12, maxLen = 180) {
  if (!Array.isArray(arr)) return [];
  const out = arr.map((x) => cleanStr(x, maxLen)).filter(Boolean);
  return out.slice(0, maxItems);
}

/**
 * ✅ FIX: accepte aussi une liste de strings (ta nouvelle page envoie des lignes),
 * et/ou une liste d’objets {title, meta, desc} (si tu évolues plus tard).
 */
function cleanModules(arr: any, maxItems = 30) {
  if (!Array.isArray(arr)) return [];

  const out: Array<{ title: string; meta?: string; desc?: string }> = [];

  for (const m of arr) {
    if (typeof m === 'string') {
      const t = cleanStr(m, 180);
      if (t) out.push({ title: t });
      continue;
    }
    if (m && typeof m === 'object') {
      const title = cleanStr(m?.title, 140);
      const meta = cleanStr(m?.meta, 80);
      const desc = cleanStr(m?.desc, 600);
      if (title) out.push({ title, meta, desc });
    }
  }

  return out.slice(0, maxItems);
}

/* ===== OPTIONS (CORS) ===== */
export async function OPTIONS(req: Request) {
  return handleOptions(req);
}

/* =====================================================================
   GET /api/courses
   → Liste les formations + renvoie le quota Starter
   + renvoie mf_theme / theme_label pour les blocs de thématiques

   ✅ Public mode:
   - accepte ?handle=xxx ou ?u=xxx
   - accepte ?public=1
   - resolve handle -> email (via tag customer mf_handle:<handle>)
   - ne renvoie que published + pas de quota
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

    const handle =
      (url.searchParams.get('handle') || '').trim() ||
      (url.searchParams.get('u') || '').trim();

    const isPublic = url.searchParams.get('public') === '1';

    let email = (url.searchParams.get('email') || '').trim();

    // ✅ PUBLIC: handle -> customerId -> email
    if (!email && handle) {
      const cid = await findCustomerIdByHandle(handle);
      if (cid) email = await getCustomerEmailById(cid);
    }

    if (!email) {
      return jsonWithCors(
        req,
        { ok: false, error: 'email_or_handle_required' },
        { status: 400 },
      );
    }

    const vendor = email;

    const r = await shopifyFetch(
      `/products.json?vendor=${encodeURIComponent(vendor)}&limit=250`,
    );
    if (!r.ok) {
      return jsonWithCors(
        req,
        { ok: false, error: `Shopify ${r.status}`, detail: r.text },
        { status: r.status },
      );
    }

    const products = (r.json as any)?.products || [];

    const itemsRaw = await Promise.all(
      products.map(async (p: any) => {
        const themeHandleRaw = await getProductMetafieldValue(p.id, 'mfapp', 'theme');
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
          url: p.handle ? `/products/${p.handle}` : '',
        };
      }),
    );

    const items = isPublic ? itemsRaw.filter((x) => !!x.published) : itemsRaw;

    let plan: 'Starter' | 'Pro' | 'Business' | 'Unknown' = 'Unknown';
    let quota: any = null;

    // ✅ Privé seulement (pas de quota en public)
    if (!isPublic && email) {
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
        quota = { plan, limit: null, used: null, remaining: null };
      }
    }

    return jsonWithCors(req, { ok: true, items, plan, quota });
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
   + enregistre la thématique (mfapp.theme)
   + crée / met à jour la Course en base Prisma
   + écrit les champs synchronisés pour la fiche produit
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

      // ✅ FIX: récupérer le prix (front "compte formateur" + nouvelle page)
      price,

      pdfUrl: pdfUrlRaw,
      pdf_url,
      status = 'active',
      collectionId,
      collectionHandle,
      collectionHandleOrId,

      theme,
      themeHandle,
      mf_theme,

      // ✅ FIX: ton nouveau front envoie mfapp:{...}
      mfapp,

      // compat: anciens champs top-level si tu en as encore quelque part
      subtitle,
      learn,
      modules,
      audience,
      duration_text,
      level_text,
      language_text,
      requirements,
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

    // ✅ FIX: normaliser prix Shopify (string "12.34")
    let priceStr = '';
    if (price !== undefined && price !== null && String(price).trim() !== '') {
      const n = Number(price);
      if (!Number.isNaN(n) && n >= 0) priceStr = n.toFixed(2);
      else priceStr = String(price).trim();
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

        variants: [
          {
            requires_shipping: false,
            taxable: false,

            // ✅ FIX: on met le prix directement sur le variant si fourni
            ...(priceStr ? { price: priceStr } : {}),
          },
        ],
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

    /* Métachamps mkt (comme avant) */
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
    await upsertProductMetafield(created.id, 'mkt', 'pdf_url', 'url', pdfUrl);

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

    if (!themeHandleFinal && selector && typeof selector === 'string') {
      const isNumeric = /^[0-9]+$/.test(selector);
      if (!isNumeric) themeHandleFinal = selector.trim();
    }

    if (selector) {
      const cid = await resolveCollectionId(selector);
      if (cid) {
        await shopifyFetch(`/collects.json`, {
          json: { collect: { product_id: created.id, collection_id: cid } },
        });
      }
    }

    if (themeHandleFinal) {
      await upsertProductMetafield(
        created.id,
        'mfapp',
        'theme',
        'single_line_text_field',
        themeHandleFinal,
      );
    }

    // =====================================================
    // ✅ Synchro fiche produit (Udemy-like)
    // - support mfapp:{} (nouvelle page)
    // - support anciens champs top-level (compat)
    // =====================================================
    try {
      const mf = (mfapp && typeof mfapp === 'object') ? mfapp : {};

      const subtitleFinal = cleanStr(mf.subtitle ?? subtitle, 600);
      const formatFinal = cleanStr(mf.format ?? '', 60);
      const levelFinal = cleanStr(mf.level ?? level_text ?? '', 80);
      const durationFinal = cleanStr(mf.duration ?? duration_text ?? '', 80);

      const learnArr = cleanList(mf.learn ?? learn, 12, 160);
      const audienceArr = cleanList(mf.audience ?? audience, 12, 160);
      const includesArr = cleanList(mf.includes ?? [], 12, 160);
      const reqArr = cleanList(requirements, 10, 160);
      const modulesArr = cleanModules(mf.modules ?? modules, 30);

      if (subtitleFinal) {
        await upsertProductMetafield(
          created.id,
          'mfapp',
          'subtitle',
          'multi_line_text_field',
          subtitleFinal,
        );
      }

      if (formatFinal) {
        await upsertProductMetafield(
          created.id,
          'mfapp',
          'format',
          'single_line_text_field',
          formatFinal,
        );
      }

      if (durationFinal) {
        await upsertProductMetafield(
          created.id,
          'mfapp',
          'duration',
          'single_line_text_field',
          durationFinal,
        );
      }

      if (levelFinal) {
        await upsertProductMetafield(
          created.id,
          'mfapp',
          'level',
          'single_line_text_field',
          levelFinal,
        );
      }

      if (language_text && String(language_text).trim()) {
        await upsertProductMetafield(
          created.id,
          'mfapp',
          'language_text',
          'single_line_text_field',
          cleanStr(language_text, 60),
        );
      }

      if (learnArr.length) {
        await upsertProductMetafield(
          created.id,
          'mfapp',
          'learn',
          'json',
          JSON.stringify(learnArr),
        );
      }

      if (modulesArr.length) {
        await upsertProductMetafield(
          created.id,
          'mfapp',
          'modules',
          'json',
          JSON.stringify(modulesArr),
        );
      }

      if (audienceArr.length) {
        await upsertProductMetafield(
          created.id,
          'mfapp',
          'audience',
          'json',
          JSON.stringify(audienceArr),
        );
      }

      if (includesArr.length) {
        await upsertProductMetafield(
          created.id,
          'mfapp',
          'includes',
          'json',
          JSON.stringify(includesArr),
        );
      }

      if (reqArr.length) {
        await upsertProductMetafield(
          created.id,
          'mfapp',
          'requirements',
          'json',
          JSON.stringify(reqArr),
        );
      }
    } catch (e) {
      console.error('[MF] sync metafields error', e);
      // On ne bloque pas la création si un metafield sync échoue
    }

    // =====================================================
    // Prisma (on garde le comportement + améliore subtitle si fourni)
    // =====================================================
    try {
      const shopifyProductId = String(created.id);
      const shopifyProductHandle = created.handle || null;
      const shopifyProductTitle = created.title || title;

      const mfThemeKey = themeHandleFinal || '';
      const categoryLabel =
        mfThemeKey && THEME_LABELS[mfThemeKey] ? THEME_LABELS[mfThemeKey] : null;

      const accessUrl = shopifyProductHandle ? `/products/${shopifyProductHandle}` : '';

      const mf = (mfapp && typeof mfapp === 'object') ? mfapp : {};
      const subtitleFinal =
        (String(mf.subtitle ?? subtitle ?? '').trim()) || (description || null);

      await (prisma as any).course.upsert({
        where: { shopifyProductId },
        update: {
          shopifyProductHandle,
          shopifyProductTitle,
          title,
          subtitle: subtitleFinal,
          imageUrl,
          pdfUrl,
          accessUrl,
          categoryLabel,
          trainerEmail: email,
          trainerShopifyId: shopifyCustomerId ? String(shopifyCustomerId) : null,
        },
        create: {
          shopifyProductId,
          shopifyProductHandle,
          shopifyProductTitle,
          title,
          subtitle: subtitleFinal,
          imageUrl,
          pdfUrl,
          accessUrl,
          categoryLabel,
          trainerEmail: email,
          trainerShopifyId: shopifyCustomerId ? String(shopifyCustomerId) : null,
        },
      });
    } catch (e) {
      console.error('[MF] prisma.course upsert error', e);
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

// (tes helpers en bas ne gênaient pas, je les laisse si tu veux, mais ils ne sont pas utilisés ici)
function mfText(ns: string, key: string, value?: string) {
  const v = (value || '').trim();
  if (!v) return null;
  return { namespace: ns, key, type: 'single_line_text_field', value: v };
}
function mfUrl(ns: string, key: string, value?: string) {
  const v = (value || '').trim();
  if (!v) return null;
  return { namespace: ns, key, type: 'url', value: v };
}
function mfJson(ns: string, key: string, value: any) {
  if (value == null) return null;
  if (Array.isArray(value) && value.length === 0) return null;
  return { namespace: ns, key, type: 'json', value: JSON.stringify(value) };
}
