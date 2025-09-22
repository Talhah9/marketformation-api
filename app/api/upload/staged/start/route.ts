// DÃ©marre un upload "staged" Shopify et renvoie l'URL S3 + paramÃ¨tres POST.
// Appel: POST /api/upload/staged/start?kind=image|pdf  body: { filename, mimeType }
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function env(n:string){ const v=process.env[n]; if(!v) throw new Error(`Missing env: ${n}`); return v; }
const apiV = () => (process.env.SHOPIFY_API_VERSION || '2024-07');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Vary': 'Origin',
};
export async function OPTIONS(){ return new Response(null,{status:204,headers:CORS}); }

async function gql(query:string, variables:any){
  const url = `https://${env('SHOPIFY_STORE_DOMAIN')}/admin/api/${apiV()}/graphql.json`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': env('SHOPIFY_ADMIN_API_ACCESS_TOKEN'),
    },
    body: JSON.stringify({ query, variables }),
  });
  const json:any = await res.json();
  if (!res.ok || json.errors) throw new Error(json.errors ? JSON.stringify(json.errors) : `Shopify ${res.status}`);
  return json.data;
}

export async function POST(req: Request){
  try{
    const { searchParams } = new URL(req.url);
    const kind = (searchParams.get('kind') || 'pdf').toLowerCase(); // 'image' | 'pdf'
    const body = await req.json().catch(()=> ({}));
    const filename = body?.filename || (kind === 'image' ? `image-${Date.now()}.png` : `file-${Date.now()}.pdf`);
    const mimeType = body?.mimeType || (kind === 'image' ? 'image/png' : 'application/pdf');

    const resource = (kind === 'image') ? 'IMAGE' : 'FILE';

    const data = await gql(`
      mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets { url resourceUrl parameters { name value } }
          userErrors { field message }
        }
      }
    `, { input: [{ resource, filename, mimeType, httpMethod: "POST" }]});

    const t = data?.stagedUploadsCreate?.stagedTargets?.[0];
    const ue = data?.stagedUploadsCreate?.userErrors || [];
    if (!t?.url || !t?.resourceUrl) {
      return new Response(JSON.stringify({ ok:false, error:'staging_failed', userErrors: ue }), { status: 400, headers:{'Content-Type':'application/json', ...CORS} });
    }

    return new Response(JSON.stringify({
      ok: true,
      kind,
      filename,
      mimeType,
      postUrl: t.url,
      resourceUrl: t.resourceUrl,
      params: t.parameters || []
    }), { status: 200, headers: { 'Content-Type': 'application/json', ...CORS } });
  }catch(e:any){
    return new Response(JSON.stringify({ ok:false, error: e?.message || 'start_failed' }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...CORS }
    });
  }
}

