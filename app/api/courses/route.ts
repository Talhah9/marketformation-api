// Crée un produit "Course" et liste les courses du formateur (par email via tag)
// Requiert: SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_API_ACCESS_TOKEN
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Vary': 'Origin'
};
function corsJson(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
}
export async function OPTIONS(){ return new Response(null,{status:204,headers:CORS}); }

function requireEnv(n:string){ const v = process.env[n]; if(!v) throw new Error(`Missing env: ${n}`); return v; }
const shopDomain = () => `https://${requireEnv('SHOPIFY_STORE_DOMAIN')}`;
const apiV       = () => (process.env.SHOPIFY_API_VERSION || '2024-07');

async function shopifyREST(path:string, init:RequestInit){
  const url = `${shopDomain()}/admin/api/${apiV()}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { 'X-Shopify-Access-Token': requireEnv('SHOPIFY_ADMIN_API_ACCESS_TOKEN'), 'Content-Type':'application/json', ...(init.headers||{}) }
  });
  const txt = await res.text(); let json:any = {}; try{ json = txt?JSON.parse(txt):{} }catch{}
  if(!res.ok) throw new Error(json?.errors ? JSON.stringify(json.errors) : `Shopify ${res.status}`);
  return json;
}
async function shopifyGQL(query:string, variables:any){
  const url = `${shopDomain()}/admin/api/${apiV()}/graphql.json`;
  const res = await fetch(url, {
    method:'POST',
    headers: { 'X-Shopify-Access-Token': requireEnv('SHOPIFY_ADMIN_API_ACCESS_TOKEN'), 'Content-Type':'application/json' },
    body: JSON.stringify({ query, variables })
  });
  const json:any = await res.json();
  if(json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}
const sanitizeTag = (s:string) => ('trainer:' + s.toLowerCase().replace(/[^a-z0-9]+/g,'-')).replace(/-+/g,'-');

// GET: liste des formations du formateur (par email → tag)
export async function GET(req: Request) {
  try {
    const sp    = new URL(req.url).searchParams;
    const email = (sp.get('email') || '').trim().toLowerCase();
    if (!email) return corsJson({ items: [] });
    const trainerTag = sanitizeTag(email); // ex: trainer:john-gmail-com
    const q = `tag:mf-course AND tag:${trainerTag}`;

    const data = await shopifyGQL(`
      query($q: String!) {
        products(first: 50, query: $q) {
          nodes {
            id
            title
            handle
            featuredImage { url }
            collections(first: 1) { nodes { handle } }
          }
        }
      }
    `, { q });

    const items = (data?.products?.nodes || []).map((p:any) => ({
      title: p.title,
      handle: p.handle,
      coverUrl: p.featuredImage?.url || '',
      collectionHandle: p.collections?.nodes?.[0]?.handle || ''
    }));

    return corsJson({ items });
  } catch (e:any) {
    return corsJson({ items: [], error: e?.message || 'list_failed' }, 200);
  }
}

// POST: création produit dans Shopify
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { title, description, coverUrl, pdfUrl, collectionHandle, price, customerEmail } = body || {};
    if (!title) return corsJson({ error: 'title_required' }, 400);

    const trainerTag = customerEmail ? sanitizeTag(String(customerEmail)) : undefined;

    // 1) Créer le produit (image externe déjà hébergée sur Shopify Files)
    const payload = {
      product: {
        title,
        body_html: description || '',
        product_type: 'Course',
        status: 'active',
        tags: ['mf-course', collectionHandle, trainerTag].filter(Boolean).join(', '),
        images: coverUrl ? [{ src: coverUrl }] : [],
        variants: [{
          price: ((Number(price) || 1990) / 100).toFixed(2),
          requires_shipping: false,
          taxable: false,
          inventory_management: null
        }]
      }
    };
    const created = await shopifyREST('/products.json', { method: 'POST', body: JSON.stringify(payload) });
    const product = created.product;

    // 2) Métachamps utiles
    const metafields:any[] = [];
    if (pdfUrl) metafields.push({
      owner_resource: 'product', owner_id: product.id,
      namespace: 'mf', key: 'pdf_url', type: 'url', value: pdfUrl
    });
    if (customerEmail) metafields.push({
      owner_resource: 'product', owner_id: product.id,
      namespace: 'mf', key: 'trainer_email', type: 'single_line_text_field', value: String(customerEmail)
    });
    for (const m of metafields) {
      try { await shopifyREST('/metafields.json', { method:'POST', body: JSON.stringify({ metafield: m }) }); } catch {}
    }

    // 3) Ajout à la collection (si handle fourni)
    if (collectionHandle) {
      try {
        let collId:number|undefined;
        const cc = await shopifyREST(`/custom_collections.json?handle=${encodeURIComponent(collectionHandle)}`);
        if (cc?.custom_collections?.[0]) collId = cc.custom_collections[0].id;
        if (!collId) {
          const sc = await shopifyREST(`/smart_collections.json?handle=${encodeURIComponent(collectionHandle)}`);
          if (sc?.smart_collections?.[0]) collId = sc.smart_collections[0].id;
        }
        if (collId) {
          await shopifyREST('/collects.json', { method:'POST', body: JSON.stringify({ collect: { product_id: product.id, collection_id: collId } }) });
        }
      } catch {}
    }

    return corsJson({
      ok: true,
      id: product.id,
      handle: product.handle,
      admin_url: `${shopDomain()}/admin/products/${product.id}`
    }, 201);
  } catch (e:any) {
    return corsJson({ error: e?.message || 'create_failed' }, 500);
  }
}
