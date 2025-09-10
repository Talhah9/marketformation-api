// Upload PDF → Shopify Files (GraphQL staged upload) → { url }
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

export async function POST(req: Request){
  try{
    const fd = await req.formData();
    const file = fd.get('pdf') || fd.get('file');
    if(!(file instanceof File)){
      return new Response(JSON.stringify({error:"field 'pdf' manquant"}),{status:400,headers:{'Content-Type':'application/json',...CORS}});
    }

    const filename = file.name || `course-${Date.now()}.pdf`;
    const mimeType = file.type || 'application/pdf';

    // 1) stagedUploadsCreate → cible S3 + paramètres
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

    // 2) upload binaire vers S3 signé
    const s3 = new FormData();
    for (const p of params) s3.append(p.name, p.value);
    s3.append('file', file);
    const s3Res = await fetch(postUrl, { method: 'POST', body: s3 });
    if (!s3Res.ok) throw new Error(`s3_upload_failed ${s3Res.status}`);

    // 3) fileCreate → création du GenericFile dans Shopify
    const data2 = await gql(`
      mutation fileCreate($files: [FileCreateInput!]!) {
        fileCreate(files: $files) {
          files {
            __typename
            ... on GenericFile { id url }
            ... on MediaImage { id image { url } }
          }
          userErrors { field message }
        }
      }
    `, {
      files: [{
        originalSource: resourceUrl,
        contentType: "FILE",     // GenericFile
        alt: filename
      }]
    });

    const created = data2?.fileCreate?.files?.[0];
    const url = created?.url; // GenericFile.url
    if (!url) throw new Error('file_create_failed');

    return new Response(JSON.stringify({ url }), { status:200, headers:{'Content-Type':'application/json',...CORS} });
  }catch(e:any){
    return new Response(JSON.stringify({ error: e?.message || 'upload_failed' }), { status:500, headers:{'Content-Type':'application/json',...CORS} });
  }
}
