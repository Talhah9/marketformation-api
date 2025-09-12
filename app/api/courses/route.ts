// Crée un produit Course et liste les courses d'un formateur via tag trainer:<email>
// app/api/courses/route.ts
import { handleOptions, jsonWithCors } from '@/app/api/_lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ====== ENV attendus ======
// SHOPIFY_STORE_DOMAIN  -> ex: tqiccz-96.myshopify.com
// SHOPIFY_ADMIN_API_ACCESS_TOKEN -> shpat_xxx (Admin API)
// SHOPIFY_API_VERSION   -> "2025-07" (facultatif, défaut ci-dessous)

const STORE = process.env.SHOPIFY_STORE_DOMAIN!;
const TOKEN = process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN!;
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-07';

if (!STORE || !TOKEN) {
  console.warn('[courses] Missing SHOPIFY_* envs');
}

type CreateCourseBody = {
  title: string;
  description: string;
  collectionHandle?: string;
  coverUrl?: string;   // URL publique retournée par /api/upload/image
  pdfUrl?: string;     // URL publique retournée par /api/upload/pdf
  price?: number;      // en centimes (ex: 1990 = 19,90€)
  customerEmail?: string | null;
  customerId?: number | null;
};

export async function OPTIONS(req: Request) {
  // Préflight CORS
  return handleOptions(req);
}

export async function POST(req: Request) {
  try {
    // Sécurité basique + CORS pour JSON
    const contentType = req.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return jsonWithCors(req, { ok: false, error: 'content_type_required_json' }, { status: 415 });
    }

    const body = (await req.json()) as CreateCourseBody;
    const {
      title,
      description,
      collectionHandle,
      coverUrl,
      pdfUrl,
      price,
      customerEmail,
      customerId,
    } = body || {};

    if (!title || !description) {
      return jsonWithCors(req, { ok: false, error: 'missing_fields' }, { status: 400 });
    }

    if (!STORE || !TOKEN) {
      return jsonWithCors(req, { ok: false, error: 'server_misconfigured' }, { status: 500 });
    }

    // 1) Création du produit
    // Si tu veux le publier directement: status: "active"
    // Sinon "draft".
    const productPayload = {
      product: {
        title,
        body_html: description,
        status: 'active',
        tags: ['mf_trainer'], // <- demandé
        images: coverUrl ? [{ src: coverUrl }] : [],
        // On peut créer une variante pour avoir un prix (en €).
        variants: [
          {
            price: price ? (price / 100).toFixed(2) : '19.90',
            requires_shipping: false,
            taxable: false,
            option1: 'Default',
          },
        ],
        options: [{ name: 'Title' }],
        // Metafields pour stocker l'URL du PDF côté admin
        metafields: pdfUrl
          ? [
              {
                namespace: 'mf',
                key: 'pdf_url',
                type: 'single_line_text_field',
                value: pdfUrl,
              },
            ]
          : [],
      },
    };

    const base = `https://${STORE}/admin/api/${API_VERSION}`;
    const resp = await fetch(`${base}/products.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': TOKEN,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(productPayload),
    });

    const tx = await resp.text();
    let created: any = {};
    try { created = tx ? JSON.parse(tx) : {}; } catch {}

    if (!resp.ok) {
      return jsonWithCors(
        req,
        { ok: false, error: 'product_create_failed', detail: created?.errors || tx || resp.statusText },
        { status: 502 },
      );
    }

    const product = created?.product;
    const productId: number | undefined = product?.id;
    const productHandle: string | undefined = product?.handle;

    // 2) Ajouter à une collection par handle (optionnel)
    if (productId && collectionHandle) {
      // On cherche la custom collection par "handle"
      const cc = await fetch(`${base}/custom_collections.json?handle=${encodeURIComponent(collectionHandle)}`, {
        headers: {
          'X-Shopify-Access-Token': TOKEN,
          'Accept': 'application/json',
        },
      });
      const cctxt = await cc.text();
      let col: any = {};
      try { col = cctxt ? JSON.parse(cctxt) : {}; } catch {}

      const collId: number | undefined = col?.custom_collections?.[0]?.id;
      if (collId) {
        const collectResp = await fetch(`${base}/collects.json`, {
          method: 'POST',
          headers: {
            'X-Shopify-Access-Token': TOKEN,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({ collect: { product_id: productId, collection_id: collId } }),
        });
        if (!collectResp.ok) {
          const msg = await collectResp.text();
          console.warn('[courses] collect failed:', msg);
        }
      } else {
        console.warn(`[courses] collection not found for handle="${collectionHandle}"`);
      }
    }

    // 3) Optionnel: logger qui a créé (customerId/email) — tu peux le garder en métadonnées si besoin

    // URL publique du produit
    const onlineUrl =
      product?.handle ? `https://${STORE}/products/${product.handle}` : undefined;

    return jsonWithCors(req, {
      ok: true,
      productId,
      handle: productHandle,
      url: onlineUrl,
    });
  } catch (e: any) {
    return jsonWithCors(req, { ok: false, error: e?.message || 'courses_failed' }, { status: 500 });
  }
}
