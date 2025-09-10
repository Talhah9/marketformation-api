// Upload PDF vers Shopify Files (GraphQL staged upload) avec fallback REST.
// Prérequis env: SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_API_ACCESS_TOKEN
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Vary': 'Origin',
};
export async function OPTIONS(){ return new Response(null,{status:204,headers:CORS}); }

function env(n:string){ const v=process.env[n]; if(!v) throw new Error(`Missing env: ${n}`); return v; }
const apiV = () => (process.env.SHOPIFY_API_VERSION || '2024-07');

async function gql(query: string, variables: any){
  const url = `https://${env('SHOPIFY_STORE_DOMAIN')}/admin/api/${apiV()}/graphql.json`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': env('SHOPIFY_ADMIN_API_ACCESS_TOKEN')
    },
    body: JSON.stringify({ query, variables })
  });
  const json: any = await res.json();
  if (!res.ok || json.errors) throw new Error(json.errors ? JSON.stringify(json.errors) : `Shopify ${res.status}`);
  return json.data;
}

async function rest(path: string, init: RequestInit){
  const url = `https://${env('SHOPIFY_STORE_DOMAIN')}/admin/api/${apiV()}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': env('SHOPIFY_ADMIN_API_ACCESS_TOKEN'),
      ...(init.headers || {})
    }
  });
  const txt = await res.text(); let json:any = {}; try { json = txt ? JSON.parse(txt) : {}; } catch {}
  if (!res.ok) throw new Error(json?.errors ? JSON.stringify(json.errors) : `Shopify ${res.status}`);
  return json;
}

export async function POST(req: Request){
  try{
    const fd = await req.formData();
    const file = fd.get('pdf') || fd.get('file');
    if(!(file instanceof File)){
      return new Response(JSON.stringify({error:"field 'pdf' manquant"}),{status:400,headers:{'Content-Type':'application/json',...CORS}});
    }
    const filename = file.name || `course-${Date.now()}.pdf`;
    const mimeType = file.type || 'application/pdf';

    // ---------- 1) TENTATIVE GRAPHQL (staged uploads) ----------
    try {
      // a) stagedUploadsCreate
      const data1 = await gql(`
        mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
          stagedUploadsCreate(input: $input) {
            stagedTargets { url resourceUrl parameters { name value } }
            userErrors { field message }
          }
        }
      `, {
        input: [{
          resource: "FILE",
          filename,
          mimeType,
          httpMethod: "POST"
        }]
      });

      const target = data1?.stagedUploadsCreate?.stagedTargets?.[0];
      const params = target?.parameters || [];
      const postUrl = target?.url;
      const resourceUrl = target?.resourceUrl;
      if (!postUrl || !resourceUrl) throw new Error('staging_failed');

      // b) upload binaire signé (S3)
      const s3 = new FormData();
      for (const p of params) s3.append(p.name, p.value);
      s3.append('file', file);
      const s3Res = await fetch(postUrl, { method: 'POST', body: s3 });
      if (!s3Res.ok) throw new Error(`s3_upload_failed ${s3Res.status}`);

      // c) fileCreate -> GenericFile
      const data2 = await gql(`
        mutation fileCreate($files: [FileCreateInput!]!) {
          fileCreate(files: $files) {
            files { __typename ... on GenericFile { id url } }
            userErrors { field message }
          }
        }
      `, {
        files: [{ originalSource: resourceUrl, contentType: "FILE", alt: filename }]
      });

      const created = data2?.fileCreate?.files?.[0];
      const url = created?.url;
      if (!url) throw new Error('file_create_failed');

      return new Response(JSON.stringify({ url }), { status:200, headers:{'Content-Type':'application/json',...CORS} });
    } catch (eGraphQL:any) {
      // ---------- 2) FALLBACK REST (base64 + mime_type) ----------
      try {
        const attachment = Buffer.from(await file.arrayBuffer()).toString('base64');
        const out = await rest('/files.json', {
          method:'POST',
          body: JSON.stringify({
            file: {
              attachment,
              filename,
              mime_type: mimeType // IMPORTANT en REST
            }
          })
        });
        const url = out?.file?.url || out?.files?.[0]?.url;
        if(!url) throw new Error('upload_failed_rest');
        return new Response(JSON.stringify({ url }), { status:200, headers:{'Content-Type':'application/json',...CORS} });
      } catch (eRest:any) {
        // On renvoie les deux messages pour diagnostic
        return new Response(JSON.stringify({ error: `graphQL:${eGraphQL?.message || 'failed'} | rest:${eRest?.message || 'failed'}` }), {
          status: 500, headers:{'Content-Type':'application/json',...CORS}
        });
      }
    }
  }catch(e:any){
    return new Response(JSON.stringify({ error: e?.message || 'upload_failed' }), { status:500, headers:{'Content-Type':'application/json',...CORS} });
  }
}
