// Upload image vers Shopify Files (CDN) et retourne { url }
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Vary': 'Origin',
};
export async function OPTIONS(){ return new Response(null,{status:204,headers:CORS}); }

function requireEnv(n:string){ const v = process.env[n]; if(!v) throw new Error(`Missing env: ${n}`); return v; }
async function shopify(path:string, init:RequestInit){
  const domain = requireEnv('SHOPIFY_STORE_DOMAIN');
  const token  = requireEnv('SHOPIFY_ADMIN_API_ACCESS_TOKEN');
  const apiV   = process.env.SHOPIFY_API_VERSION || '2024-07';
  const url    = `https://${domain}/admin/api/${apiV}${path}`;
  const res    = await fetch(url, {
    ...init,
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json', ...(init.headers||{}) }
  });
  const txt = await res.text(); let json:any = {}; try{ json = txt?JSON.parse(txt):{} }catch{}
  if(!res.ok) throw new Error(json?.errors ? JSON.stringify(json.errors) : `Shopify ${res.status}`);
  return json;
}

export async function POST(req: Request){
  try{
    const fd   = await req.formData();
    const file = fd.get('image') || fd.get('file');
    if(!(file instanceof File)) return new Response(JSON.stringify({error:"field 'image' manquant"}), {status:400, headers:{'Content-Type':'application/json',...CORS}});

    const buf = Buffer.from(await file.arrayBuffer()).toString('base64');
    const payload = { file: { attachment: buf, filename: file.name || `image-${Date.now()}`, content_type: file.type || 'image/png' } };
    const out = await shopify('/files.json', { method:'POST', body: JSON.stringify(payload) });
    const url = out?.file?.url || out?.files?.[0]?.url;
    if(!url) throw new Error('upload_failed');
    return new Response(JSON.stringify({ url }), { status:200, headers:{'Content-Type':'application/json',...CORS} });
  }catch(e:any){
    return new Response(JSON.stringify({ error: e?.message || 'upload_failed' }), { status:500, headers:{'Content-Type':'application/json',...CORS} });
  }
}
