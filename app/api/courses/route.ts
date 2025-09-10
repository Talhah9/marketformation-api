// Crée un produit Course et liste les courses d'un formateur via tag trainer:<email>
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Vary': 'Origin'
};
function corsJson(d:unknown,s=200){return new Response(JSON.stringify(d),{status:s,headers:{'Content-Type':'application/json',...CORS}});}
export async function OPTIONS(){return new Response(null,{status:204,headers:CORS});}

function env(n:string){const v=process.env[n]; if(!v) throw new Error(`Missing env: ${n}`); return v;}
const shopDomain = () => `https://${env('SHOPIFY_STORE_DOMAIN')}`;
const apiV       = () => (process.env.SHOPIFY_API_VERSION || '2024-07');

async function shopREST(path:string, init:RequestInit){
  const url = `${shopDomain()}/admin/api/${apiV()}${path}`;
  const res = await fetch(url,{...init,headers:{'X-Shopify-Access-Token':env('SHOPIFY_ADMIN_API_ACCESS_TOKEN'),'Content-Type':'application/json',...(init.headers||{})}});
  const txt = await res.text(); let json:any={}; try{json=txt?JSON.parse(txt):{}}catch{}
  if(!res.ok) throw new Error(json?.errors?JSON.stringify(json.errors):`Shopify ${res.status}`);
  return json;
}
async function shopGQL(query:string, variables:any){
  const res = await fetch(`${shopDomain()}/admin/api/${apiV()}/graphql.json`,{
    method:'POST',
    headers:{'X-Shopify-Access-Token':env('SHOPIFY_ADMIN_API_ACCESS_TOKEN'),'Content-Type':'application/json'},
    body: JSON.stringify({query,variables})
  });
  const out:any = await res.json();
  if(out.errors) throw new Error(JSON.stringify(out.errors));
  return out.data;
}

const trainerTag = (email:string) =>
  ('trainer:' + email.toLowerCase().replace(/[^a-z0-9]+/g,'-')).replace(/-+/g,'-');

// -------- GET: Mes formations --------
export async function GET(req: Request){
  try{
    const sp = new URL(req.url).searchParams;
    const email = (sp.get('email')||'').trim().toLowerCase();
    if(!email) return corsJson({ items: [] });

    const q = `tag:mf-course AND tag:${trainerTag(email)}`;
    const data = await shopGQL(`
      query($q:String!){
        products(first:50, query:$q){
          nodes{
            title
            handle
            featuredImage{ url }
            collections(first:1){ nodes{ handle } }
          }
        }
      }
    `,{ q });

    const items = (data?.products?.nodes||[]).map((p:any)=>({
      title: p.title,
      handle: p.handle,
      coverUrl: p.featuredImage?.url || '',
      collectionHandle: p.collections?.nodes?.[0]?.handle || ''
    }));

    return corsJson({ items });
  }catch(e:any){ return corsJson({ items: [], error: e?.message || 'list_failed' }, 200); }
}

// -------- POST: créer une course --------
export async function POST(req: Request){
  try{
    const body = await req.json();
    const { title, description, coverUrl, pdfUrl, collectionHandle, price, customerEmail } = body||{};
    if(!title) return corsJson({ error: 'title_required' }, 400);

    const tagTrainer = customerEmail ? trainerTag(String(customerEmail)) : undefined;

    // 1) créer le produit
    const created = await shopREST('/products.json',{
      method:'POST',
      body: JSON.stringify({
        product: {
          title,
          body_html: description || '',
          product_type: 'Course',
          status: 'active',
          tags: ['mf-course', collectionHandle, tagTrainer].filter(Boolean).join(', '),
          // on ne met pas l'image ici (certains shops ignorent le src) → on l'ajoute après
          variants: [{
            price: ((Number(price)||1990)/100).toFixed(2),
            requires_shipping: false, taxable: false, inventory_management: null
          }]
        }
      })
    });
    const product = created.product;

    // 2) image de couverture (assurée, même si Shopify a ignoré 'images' à la création)
    if (coverUrl) {
      try {
        await shopREST('/product_images.json', {
          method:'POST',
          body: JSON.stringify({ product_image: { product_id: product.id, src: coverUrl } })
        });
      } catch {}
    }

    // 3) métachamps (pdf + email formateur)
    const metafields:any[] = [];
    if (pdfUrl) metafields.push({ owner_resource:'product', owner_id:product.id, namespace:'mf', key:'pdf_url', type:'url', value:pdfUrl });
    if (customerEmail) metafields.push({ owner_resource:'product', owner_id:product.id, namespace:'mf', key:'trainer_email', type:'single_line_text_field', value:String(customerEmail) });
    for (const m of metafields) { try { await shopREST('/metafields.json',{method:'POST',body:JSON.stringify({metafield:m})}); } catch {} }

    // 4) ajout à la collection (si handle fourni)
    if (collectionHandle) {
      try {
        let collId:number|undefined;
        const cc = await shopREST(`/custom_collections.json?handle=${encodeURIComponent(collectionHandle)}`);
        if (cc?.custom_collections?.[0]) collId = cc.custom_collections[0].id;
        if (!collId) {
          const sc = await shopREST(`/smart_collections.json?handle=${encodeURIComponent(collectionHandle)}`);
          if (sc?.smart_collections?.[0]) collId = sc.smart_collections[0].id;
        }
        if (collId) await shopREST('/collects.json',{method:'POST',body:JSON.stringify({collect:{product_id:product.id,collection_id:collId}})});
      } catch {}
    }

    return corsJson({ ok:true, id:product.id, handle:product.handle, admin_url:`${shopDomain()}/admin/products/${product.id}` }, 201);
  }catch(e:any){
    return corsJson({ error: e?.message || 'create_failed' }, 500);
  }
}
