// Finalise l'upload: crée le fichier dans Shopify Files et renvoie l'URL finale.
// Appel: POST /api/upload/staged/finish  body: { resourceUrl, kind: "image"|"pdf", alt? }
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

async function restFilesCreate(payload:any){
  const url = `https://${env('SHOPIFY_STORE_DOMAIN')}/admin/api/${apiV()}/files.json`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': env('SHOPIFY_ADMIN_API_ACCESS_TOKEN')
    },
    body: JSON.stringify(payload)
  });
  const txt = await r.text(); let j:any = {};
  try { j = txt ? JSON.parse(txt) : {}; } catch {}
  if (!r.ok) throw new Error(j?.errors ? JSON.stringify(j.errors) : `Shopify ${r.status}`);
  return j;
}

export async function POST(req: Request){
  try{
    const { resourceUrl, kind, alt, filename, mimeType } = await req.json();
    if (!resourceUrl) {
      return new Response(JSON.stringify({ ok:false, error:'resourceUrl_required' }), { status:400, headers:{'Content-Type':'application/json', ...CORS}});
    }
    const isImage = (String(kind||'').toLowerCase() === 'image');

    // 1) Tentative GraphQL
    try {
      const data = await gql(`
        mutation fileCreate($files: [FileCreateInput!]!) {
          fileCreate(files: $files) {
            files {
              __typename
              ... on MediaImage { id image { url } }
              ... on GenericFile { id url }
            }
            userErrors { field message }
          }
        }
      `, {
        files: [{
          originalSource: resourceUrl,
          contentType: isImage ? "IMAGE" : "FILE",
          alt: alt || null
        }]
      });

      const userErrors = data?.fileCreate?.userErrors || [];
      const f = data?.fileCreate?.files?.[0];
      const url = isImage ? f?.image?.url : f?.url;

      if (url) {
        return new Response(JSON.stringify({ ok:true, url }), { status:200, headers:{'Content-Type':'application/json', ...CORS} });
      }

      // 2) Fallback REST (on récupère le binaire depuis S3, puis /files.json en base64)
      const s3 = await fetch(resourceUrl);
      if (!s3.ok) throw new Error(`s3_fetch_failed_${s3.status}`);
      const buff = Buffer.from(await s3.arrayBuffer());
      const attachment = buff.toString('base64');

      const restPayload = {
        file: {
          attachment,
          filename: filename || (isImage ? `image-${Date.now()}.bin` : `file-${Date.now()}.bin`),
          mime_type: mimeType || (isImage ? 'image/png' : 'application/octet-stream')
        }
      };
      const out = await restFilesCreate(restPayload);
      const restUrl = out?.file?.url || out?.files?.[0]?.url;
      if (!restUrl) throw new Error('rest_upload_failed');

      return new Response(JSON.stringify({ ok:true, url: restUrl, userErrors }), { status:200, headers:{'Content-Type':'application/json', ...CORS} });
    } catch (eG:any) {
      // 3) S’il y a eu une exception GQL → tenter quand même REST direct
      try {
        const s3 = await fetch(resourceUrl);
        if (!s3.ok) throw new Error(`s3_fetch_failed_${s3.status}`);
        const buff = Buffer.from(await s3.arrayBuffer());
        const attachment = buff.toString('base64');

        const restPayload = {
          file: {
            attachment,
            filename: filename || (isImage ? `image-${Date.now()}.bin` : `file-${Date.now()}.bin`),
            mime_type: mimeType || (isImage ? 'image/png' : 'application/octet-stream')
          }
        };
        const out = await restFilesCreate(restPayload);
        const restUrl = out?.file?.url || out?.files?.[0]?.url;
        if (!restUrl) throw new Error('rest_upload_failed');

        return new Response(JSON.stringify({ ok:true, url: restUrl, errorGraphQL: eG?.message || 'gql_failed' }), {
          status:200, headers:{'Content-Type':'application/json', ...CORS}
        });
      } catch (eRest:any) {
        return new Response(JSON.stringify({ ok:false, error: `finish_failed`, details:{ graphQL: eG?.message || 'gql_failed', rest: eRest?.message || 'rest_failed' } }), {
          status:500, headers:{'Content-Type':'application/json', ...CORS}
        });
      }
    }
  }catch(e:any){
    return new Response(JSON.stringify({ ok:false, error: e?.message || 'finish_failed' }), {
      status: 500, headers:{'Content-Type':'application/json', ...CORS}
    });
  }
}
