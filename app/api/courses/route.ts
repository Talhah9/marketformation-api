// Crée un produit Course et liste les courses d'un formateur via tag trainer:<email>
// app/api/courses/route.ts
// app/api/courses/route.ts
// app/api/courses/route.ts
import { handleOptions, jsonWithCors } from '@/app/api/_lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STORE = process.env.SHOPIFY_STORE_DOMAIN!;                     // ex: tqiccz-96.myshopify.com (sans https)
const TOKEN = process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN!;           // shpat_...
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-07';

type CreateCourseBody = {
  title: string;
  description: string;
  collectionHandle?: string;
  coverUrl?: string;
  pdfUrl?: string;
  price?: number;        // centimes
  customerEmail?: string | null;
  customerId?: number | null;
};

async function shopifyFetch(path: string, init?: RequestInit) {
  const url = `https://${STORE}/admin/api/${API_VERSION}${path}`;
  const r = await fetch(url, {
    ...init,
    headers: {
      'X-Shopify-Access-Token': TOKEN,
      'Accept': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const text = await r.text();
  let json: any = undefined;
  try { json = text ? JSON.parse(text) : undefined; } catch {}
  return { ok: r.ok, status: r.status, json, text, statusText: r.statusText };
}

/* ---------- CORS preflight ---------- */
export async function OPTIONS(req: Request) {
  return handleOptions(req);
}

/* ---------- GET /api/courses?email=...  ---------- */
/* Liste les formations de l’utilisateur :
   - filtre par vendor = email (défini à la création)
   - renvoie un tableau items[] consumable par ton JS
*/
export async function GET(req: Request) {
  try {
    if (!STORE || !TOKEN) {
      return jsonWithCors(req, { ok: false, error: 'server_misconfigured' }, { status: 500 });
    }

    const url = new URL(req.url);
    const email = (url.searchParams.get('email') || '').trim();
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 250);

    // champs utiles pour la liste
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
    // ne garder que ceux taggés mf_trainer (sécurité côté lecture)
    const filtered = products.filter((p: any) => (p.tags || '').split(',').map((t: string) => t.trim().toLowerCase()).includes('mf_trainer'));

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
    return jsonWithCors(req, { ok: false, error: e?.message || 'list_failed' }, { status: 500 });
  }
}

/* ---------- POST /api/courses  ---------- */
/* Création d’une formation : payload minimal + ajouts post-création */
export async function POST(req: Request) {
  try {
    const ct = req.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      return jsonWithCors(req, { ok: false, error: 'content_type_required_json' }, { status: 415 });
    }
    if (!STORE || !TOKEN) {
      return jsonWithCors(req, { ok: false, error: 'server_misconfigured' }, { status: 500 });
    }

    const body = (await req.json()) as CreateCourseBody;
    const {
      title, description, collectionHandle, coverUrl, pdfUrl, price,
      customerEmail, customerId
    } = body || {};
    if (!title || !description) {
      return jsonWithCors(req, { ok: false, error: 'missing_fields' }, { status: 400 });
    }

    // 0) Ping boutique
    const ping = await shopifyFetch('/shop.json');
    if (!ping.ok) {
      return jsonWithCors(req, {
        ok: false,
        error: 'shop_ping_failed',
        detail: ping.json?.errors || ping.text || ping.statusText,
        status: ping.status,
      }, { status: 502 });
    }

    // 1) Création produit (minimal & robuste)
    const variantPrice = price ? (price / 100).toFixed(2) : '19.90';
    const productPayload = {
      product: {
        title,
        body_html: description,
        status: 'active',
        tags: ['mf_trainer'],
        // <— IMPORTANT : vendor = email pour pouvoir filtrer en GET
        vendor: (customerEmail || 'mf').toString(),
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

    // 2) Image après création
    if (productId && coverUrl) {
      const img = await shopifyFetch(`/products/${productId}/images.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: { src: coverUrl } }),
      });
      if (!img.ok) console.warn('[courses] add image failed', img.status, img.text);
    }

    // 3) Metafields owner & pdf
    if (productId) {
      // owner email
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
      // owner id
      if (typeof customerId === 'number') {
        const mfOwnerId = await shopifyFetch(`/products/${productId}/metafields.json`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            metafield: {
              namespace: 'mf',
              key: 'owner_id',
              type: 'number_integer',
              value: String(customerId),
            },
          }),
        });
        if (!mfOwnerId.ok) console.warn('[courses] owner_id metafield failed', mfOwnerId.status, mfOwnerId.text);
      }
      // pdf
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

    // 4) Ajout à la collection par handle (optionnel)
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
    return jsonWithCors(req, { ok: false, error: e?.message || 'courses_failed' }, { status: 500 });
  }
}
