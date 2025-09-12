// Finalise l'upload: crée le fichier dans Shopify Files et renvoie l'URL finale.
// Appel: POST /api/upload/staged/finish  body: { resourceUrl, kind: "image"|"pdf", alt? }
// app/api/upload/staged/finish/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function env(n: string) {
  const v = process.env[n];
  if (!v) throw new Error(`Missing env: ${n}`);
  return v;
}
const apiV = () => process.env.SHOPIFY_API_VERSION || '2024-07';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  Vary: 'Origin',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

async function gql(query: string, variables: any) {
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

  const json: any = await res.json();
  if (!res.ok || json.errors) {
    throw new Error(json.errors ? JSON.stringify(json.errors) : `Shopify ${res.status}`);
  }
  return json.data;
}

export async function POST(req: Request) {
  try {
    const { resourceUrl, kind, alt } = await req.json();

    if (!resourceUrl) {
      return new Response(
        JSON.stringify({ ok: false, error: 'resourceUrl_required' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...CORS } }
      );
    }

    const isImage = String(kind || '').toLowerCase() === 'image';

    // IMPORTANT : contentType = IMAGE (image) | GENERIC_FILE (pdf/autres)
    const data = await gql(
      `
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
    `,
      {
        files: [
          {
            originalSource: resourceUrl,
            contentType: isImage ? 'IMAGE' : 'GENERIC_FILE',
            alt: alt || null,
          },
        ],
      }
    );

    const userErrors = data?.fileCreate?.userErrors || [];
    const f = data?.fileCreate?.files?.[0];
    const url = isImage ? f?.image?.url : f?.url;

    if (!url) {
      return new Response(
        JSON.stringify({ ok: false, error: 'file_create_failed', userErrors }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...CORS } }
      );
    }

    return new Response(
      JSON.stringify({ ok: true, url }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...CORS } }
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ ok: false, error: e?.message || 'finish_failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS } }
    );
  }
}

