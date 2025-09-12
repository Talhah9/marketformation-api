// Crée un produit Course et liste les courses d'un formateur via tag trainer:<email>
// app/api/courses/route.ts
// app/api/courses/route.ts
import { handleOptions, jsonWithCors } from '@/app/api/_lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STORE = process.env.SHOPIFY_STORE_DOMAIN!;                     // ex: tqiccz-96.myshopify.com
const TOKEN = process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN!;           // shpat_...
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-07';

type CreateCourseBody = {
  title: string;
  description: string;
  collectionHandle?: string;
  coverUrl?: string;     // URL publique (retournée par /api/upload/image)
  pdfUrl?: string;       // URL publique (retournée par /api/upload/pdf)
  price?: number;        // centimes (1990 = 19,90 €)
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

export async function OPTIONS(req: Request) {
  return handleOptions(req);
}

export async function POST(req: Request) {
  try {
    // --- Sanity / CORS ---
    const ct = req.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      return jsonWithCors(req, { ok: false, error: 'content_type_required_json' }, { status: 415 });
    }
    if (!STORE || !TOKEN) {
      return jsonWithCors(req, { ok: false, error: 'server_misconfigured' }, { status: 500 });
    }

    const body = (await req.json()) as CreateCourseBody;
    const { title, description, collectionHandle, coverUrl, pdfUrl, price } = body || {};
    if (!title || !description) {
      return jsonWithCors(req, { ok: false, error: 'missing_fields' }, { status: 400 });
    }

    // --- 0) Ping token / boutique : /shop.json ---
    const ping = await shopifyFetch('/shop.json');
    if (!ping.ok) {
      return jsonWithCors(req, {
        ok: false,
        error: 'shop_ping_failed',
        detail: ping.json?.errors || ping.text || ping.statusText,
        status: ping.status,
      }, { status: 502 });
    }

    // --- 1) Création produit : payload minimal pour éviter 422 ---
    const variantPrice = price ? (price / 100).toFixed(2) : '19.90';
    const productPayload = {
      product: {
        title,
        body_html: description,
        status: 'active',
        tags: ['mf_trainer'],
        variants: [{ price: variantPrice }],  // variante par défaut
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

    // --- 2) Image : ajout après création (évite 422 à la création si URL non accessible) ---
    if (productId && coverUrl) {
      const img = await shopifyFetch(`/products/${productId}/images.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: { src: coverUrl } }),
      });
      if (!img.ok) {
        console.warn('[courses] add image failed', img.status, img.text);
      }
    }

    // --- 3) Metafield PDF : ajout après création (évite les contraintes de définition) ---
    if (productId && pdfUrl) {
      const mf = await shopifyFetch(`/products/${productId}/metafields.json`, {
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
      if (!mf.ok) {
        console.warn('[courses] add metafield failed', mf.status, mf.text);
      }
    }

    // --- 4) Collection par handle (optionnel) ---
    if (productId && collectionHandle) {
      const cc = await shopifyFetch(`/custom_collections.json?handle=${encodeURIComponent(collectionHandle)}`);
      const collId: number | undefined = cc.json?.custom_collections?.[0]?.id;
      if (collId) {
        const collect = await shopifyFetch('/collects.json', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ collect: { product_id: productId, collection_id: collId } }),
        });
        if (!collect.ok) {
          console.warn('[courses] collect failed', collect.status, collect.text);
        }
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
