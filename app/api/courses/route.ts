// app/api/courses/route.ts
// Crée un produit Shopify (Course) via l’Admin API.
// Nécessite : SHOPIFY_STORE_DOMAIN & SHOPIFY_ADMIN_API_ACCESS_TOKEN
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Vary': 'Origin'
};
function corsJson(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS }
  });
}
export async function OPTIONS() { return new Response(null, { status: 204, headers: CORS }); }

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}
async function shopifyFetch(path: string, init: RequestInit = {}) {
  const domain = requireEnv('SHOPIFY_STORE_DOMAIN');                // ex: tqiccz-96.myshopify.com
  const token  = requireEnv('SHOPIFY_ADMIN_API_ACCESS_TOKEN');      // Admin API access token
  const apiV   = process.env.SHOPIFY_API_VERSION || '2024-07';
  const url = `https://${domain}/admin/api/${apiV}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
      ...(init.headers || {})
    }
  });
  const text = await res.text();
  let data: any = {}; try { data = text ? JSON.parse(text) : {}; } catch {}
  if (!res.ok) throw new Error(data?.errors ? JSON.stringify(data.errors) : `Shopify ${res.status}`);
  return data;
}

// GET: on peut laisser vide pour l’instant (évite “Erreur de chargement”)
export async function GET() {
  return corsJson({ items: [] });
}

// POST: création produit dans Shopify
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      title,
      description,
      coverUrl,
      pdfUrl,
      collectionHandle,
      price // en centimes, ex 1990 = 19,90 €
    } = body || {};

    if (!title) return corsJson({ error: 'title_required' }, 400);

    // 1) Créer le produit
    const productPayload = {
      product: {
        title,
        body_html: description || '',
        product_type: 'Course',
        status: 'active',
        tags: ['mf-course', collectionHandle].filter(Boolean).join(', '),
        images: coverUrl ? [{ src: coverUrl }] : [],
        variants: [{
          price: ((Number(price) || 1990) / 100).toFixed(2),
          requires_shipping: false,
          taxable: false,
          inventory_management: null
        }]
      }
    };
    const created = await shopifyFetch('/products.json', {
      method: 'POST',
      body: JSON.stringify(productPayload)
    });
    const product = created.product;

    // 2) Métachamp PDF (si fourni)
    if (pdfUrl) {
      try {
        await shopifyFetch('/metafields.json', {
          method: 'POST',
          body: JSON.stringify({
            metafield: {
              owner_resource: 'product',
              owner_id: product.id,
              namespace: 'mf',
              key: 'pdf_url',
              type: 'url',
              value: pdfUrl
            }
          })
        });
      } catch {}
    }

    // 3) Ajout à la collection par handle (si trouvé)
    if (collectionHandle) {
      try {
        let collId: number | undefined;
        const cc = await shopifyFetch(`/custom_collections.json?handle=${encodeURIComponent(collectionHandle)}`);
        if (cc?.custom_collections?.[0]) collId = cc.custom_collections[0].id;
        if (!collId) {
          const sc = await shopifyFetch(`/smart_collections.json?handle=${encodeURIComponent(collectionHandle)}`);
          if (sc?.smart_collections?.[0]) collId = sc.smart_collections[0].id;
        }
        if (collId) {
          await shopifyFetch('/collects.json', {
            method: 'POST',
            body: JSON.stringify({ collect: { product_id: product.id, collection_id: collId } })
          });
        }
      } catch {}
    }

    const domain = requireEnv('SHOPIFY_STORE_DOMAIN');
    return corsJson({
      ok: true,
      id: product.id,
      handle: product.handle,
      admin_url: `https://${domain}/admin/products/${product.id}`
    }, 201);
  } catch (e: any) {
    return corsJson({ error: e?.message || 'create_failed' }, 500);
  }
}
