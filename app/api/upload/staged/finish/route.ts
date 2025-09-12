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

async function restFilesCreate(payload: any) {
  const url = `https://${env('SHOPIFY_STORE_DOMAIN')}/admin/api/${apiV()}/files.json`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': env('SHOPIFY_ADMIN_API_ACCESS_TOKEN'),
    },
    body: JSON.stringify(payload),
  });
  const txt = await r.text();
  let j: any = {};
  try { j = txt ? JSON.parse(txt) : {}; } catch {}
  if (!r.ok) {
    throw new Error(j?.errors ? JSON.stringify(j.errors) : `Shopify REST ${r.status}`);
  }
  return j;
}

export async function POST(req: Request) {
  try {
    const { resourceUrl, kind, alt, filename, mimeType } = await req.json();

    if (!resourceUrl) {
      return new Response(
        JSON.stringify({ ok: false, error: 'resourceUrl_required' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...CORS } }
      );
    }

    const isImage = String(kind || '').toLowerCase() === 'image';
    const safeName = filename || (isImage ? `image-${Date.now()}.bin` : `file-${Date.now()}.bin`);
    const safeMime = mimeType || (isImage ? 'image/png' : 'application/octet-stream');

    // 1) TENTATIVE GRAPHQL
    try {
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
              contentType: isImage ? 'IMAGE' : 'FILE', // <-- ENUM CORRECT
              alt: alt || null,
            },
          ],
        }
      );

      const userErrors = data?.fileCreate?.userErrors || [];
      const f = data?.fileCreate?.files?.[0];
      const url = isImage ? f?.image?.url : f?.url;

      if (url) {
        return new Response(JSON.stringify({ ok: true, url }), {
          status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
        });
      }

      // 2) FALLBACK REST : utiliser directement la source signée (pas de base64)
      try {
        const out = await restFilesCreate({
          file: {
            source: resourceUrl,
            filename: safeName,
            mime_type: safeMime,
            alt: alt || undefined,
          },
        });
        const restUrl = out?.file?.url || out?.files?.[0]?.url;
        if (restUrl) {
          return new Response(JSON.stringify({ ok: true, url: restUrl, userErrors }), {
            status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
          });
        }
        // 3) DERNIER FALLBACK : télécharger puis envoyer en attachment base64
        const s3 = await fetch(resourceUrl);
        if (!s3.ok) throw new Error(`s3_fetch_failed_${s3.status}`);
        const buff = Buffer.from(await s3.arrayBuffer());
        const attachment = buff.toString('base64');
        const out2 = await restFilesCreate({
          file: {
            attachment,
            filename: safeName,
            mime_type: safeMime,
            alt: alt || undefined,
          },
        });
        const restUrl2 = out2?.file?.url || out2?.files?.[0]?.url;
        if (restUrl2) {
          return new Response(JSON.stringify({ ok: true, url: restUrl2, userErrors }), {
            status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
          });
        }
        return new Response(
          JSON.stringify({ ok: false, error: 'file_create_failed', userErrors }),
          { status: 400, headers: { 'Content-Type': 'application/json', ...CORS } }
        );
      } catch (restErr: any) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: 'file_create_failed_rest',
            details: restErr?.message || String(restErr),
            userErrors,
          }),
          { status: 400, headers: { 'Content-Type': 'application/json', ...CORS } }
        );
      }
    } catch (gqlErr: any) {
      // Si la mutation GQL elle-même crashe, on tente directement REST (source)
      try {
        const out = await restFilesCreate({
          file: {
            source: resourceUrl,
            filename: safeName,
            mime_type: safeMime,
            alt: alt || undefined,
          },
        });
        const restUrl = out?.file?.url || out?.files?.[0]?.url;
        if (restUrl) {
          return new Response(JSON.stringify({ ok: true, url: restUrl, errorGraphQL: gqlErr?.message || 'gql_failed' }), {
            status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
          });
        }
        return new Response(
          JSON.stringify({ ok: false, error: 'file_create_failed', errorGraphQL: gqlErr?.message || 'gql_failed' }),
          { status: 400, headers: { 'Content-Type': 'application/json', ...CORS } }
        );
      } catch (restErr: any) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: 'finish_failed',
            details: { graphQL: gqlErr?.message || 'gql_failed', rest: restErr?.message || 'rest_failed' },
          }),
          { status: 500, headers: { 'Content-Type': 'application/json', ...CORS } }
        );
      }
    }
  } catch (e: any) {
    return new Response(
      JSON.stringify({ ok: false, error: e?.message || 'finish_failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS } }
    );
  }
}

