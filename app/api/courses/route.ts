// CrÃ©e un produit Course et liste les courses d'un formateur via tag trainer:<email>
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function env(n: string) {
  const v = process.env[n];
  if (!v) throw new Error(`Missing env: ${n}`);
  return v;
}
const API = () => process.env.SHOPIFY_API_VERSION || '2025-07';

async function shopify(path: string, method: string, body?: any) {
  const res = await fetch(`https://${env('SHOPIFY_STORE_DOMAIN')}/admin/api/${API()}${path}`, {
    method,
    headers: {
      'X-Shopify-Access-Token': env('SHOPIFY_ADMIN_API_ACCESS_TOKEN'),
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const txt = await res.text();
  let json: any = {};
  try { json = txt ? JSON.parse(txt) : {}; } catch { json = { raw: txt }; }
  return { ok: res.ok, status: res.status, json };
}

export async function POST(req: Request) {
  try {
    const {
      title, description, collectionHandle,
      coverUrl, pdfUrl, price, customerEmail
    } = await req.json();

    if (!title || !coverUrl) {
      return new Response(JSON.stringify({ error: 'title_and_cover_required' }), { status: 400 });
    }

    // 1) CrÃ©e le produit (image par URL => Shopify lâ€™importe & lâ€™affiche)
    const productPayload = {
      product: {
        title,
        body_html: `${description || ''}${pdfUrl ? `<p><a href="${pdfUrl}" target="_blank">TÃ©lÃ©charger le programme (PDF)</a></p>` : ''}`,
        status: 'active', // 'draft' si tu prÃ©fÃ¨res
        product_type: 'Formation',
        tags: ['mf_trainer', customerEmail || ''].filter(Boolean).join(', '),
        images: coverUrl ? [{ src: coverUrl }] : []
      }
    };

    const created = await shopify('/products.json', 'POST', productPayload);
    if (!created.ok) {
      return new Response(JSON.stringify({ error: 'product_create_failed', detail: created }), { status: 400 });
    }
    const product = created.json?.product;
    const productId = product?.id;
    if (!productId) {
      return new Response(JSON.stringify({ error: 'no_product_id', detail: created.json }), { status: 400 });
    }

    // 2) Metafield PDF URL
    if (pdfUrl) {
      const mf = await shopify(`/products/${productId}/metafields.json`, 'POST', {
        metafield: {
          namespace: 'mf',
          key: 'pdf_url',
          type: 'url',
          value: pdfUrl
        }
      });
      // Pas bloquant si Ã§a Ã©choue, on continue
    }

    // 3) Ajouter Ã  la collection (par handle)
    if (collectionHandle) {
      // Essaye custom collections
      let colId: number | null = null;
      const cc = await shopify('/custom_collections.json?limit=250', 'GET');
      const foundCustom = cc.json?.custom_collections?.find((c: any) => c?.handle === collectionHandle);
      if (foundCustom) colId = foundCustom.id;

      // Sinon smart collections
      if (!colId) {
        const sc = await shopify('/smart_collections.json?limit=250', 'GET');
        const foundSmart = sc.json?.smart_collections?.find((c: any) => c?.handle === collectionHandle);
        if (foundSmart) colId = foundSmart.id;
      }

      if (colId) {
        await shopify('/collects.json', 'POST', { collect: { product_id: productId, collection_id: colId } });
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      productId,
      adminUrl: `https://${env('SHOPIFY_STORE_DOMAIN')}/admin/products/${productId}`
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || 'create_course_failed' }), { status: 500 });
  }
}

