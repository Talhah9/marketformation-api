// Finalise l'upload: crÃ©e le fichier dans Shopify Files et renvoie l'URL finale.
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

export async function OPTIONS() { return new Response(null, { status: 204, headers: CORS }); }

// ---------- utils ----------
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
  const txt = await res.text();
  let json: any = {};
  try { json = txt ? JSON.parse(txt) : {}; } catch { json = { raw: txt }; }
  return { ok: res.ok, status: res.status, body: json };
}

async function shopifyFilesCreate(payload: any) {
  const url = `https://${env('SHOPIFY_STORE_DOMAIN')}/admin/api/${apiV()}/files.json`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': env('SHOPIFY_ADMIN_API_ACCESS_TOKEN'),
    },
    body: JSON.stringify(payload),
  });
  const txt = await res.text();
  let body: any = {};
  try { body = txt ? JSON.parse(txt) : {}; } catch { body = { raw: txt }; }
  return { ok: res.ok, status: res.status, body };
}

function extractUrlFromFiles(body: any) {
  return body?.file?.url || body?.files?.[0]?.url || null;
}

// ---------- handler ----------
export async function POST(req: Request) {
  try {
    const { resourceUrl, kind, alt, filename, mimeType } = await req.json();
    if (!resourceUrl) {
      return new Response(JSON.stringify({ ok:false, error:'resourceUrl_required' }), {
        status: 400, headers: { 'Content-Type':'application/json', ...CORS }
      });
    }

    const isImage  = String(kind || '').toLowerCase() === 'image';
    const safeName = filename || (isImage ? `image-${Date.now()}.bin` : `file-${Date.now()}.pdf`);
    const safeMime = mimeType || (isImage ? 'image/png' : 'application/pdf');

    // 1) GraphQL fileCreate (IMAGE | FILE)
    let gqlUserErrors: any[] = [];
    {
      const r = await gql(
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
        { files: [{ originalSource: resourceUrl, contentType: isImage ? 'IMAGE' : 'FILE', alt: alt || null }] }
      );
      if (r.ok) {
        const data = r.body?.data;
        const f = data?.fileCreate?.files?.[0];
        const url = isImage ? f?.image?.url : f?.url;
        gqlUserErrors = data?.fileCreate?.userErrors || [];
        if (url) {
          return new Response(JSON.stringify({ ok:true, url, via:'gql' }), {
            status: 200, headers: { 'Content-Type':'application/json', ...CORS }
          });
        }
      } else {
        // on garde le corps d'erreur: r.body
        gqlUserErrors = [{ field: ['graphql'], message: JSON.stringify(r.body) }];
      }
    }

    // 2) REST files.json avec "source"
    const restSource = await shopifyFilesCreate({
      file: { source: resourceUrl, filename: safeName, mime_type: safeMime, alt: alt || undefined }
    });
    if (restSource.ok) {
      const url = extractUrlFromFiles(restSource.body);
      if (url) {
        return new Response(JSON.stringify({ ok:true, url, via:'rest_source' }), {
          status: 200, headers: { 'Content-Type':'application/json', ...CORS }
        });
      }
    }

    // 3) REST files.json avec "attachment" (base64)
    let restAttachment: any = null;
    try {
      const s3 = await fetch(resourceUrl);
      const buff = Buffer.from(await s3.arrayBuffer());
      const attachment = buff.toString('base64');
      restAttachment = await shopifyFilesCreate({
        file: { attachment, filename: safeName, mime_type: safeMime, alt: alt || undefined }
      });
      if (restAttachment.ok) {
        const url = extractUrlFromFiles(restAttachment.body);
        if (url) {
          return new Response(JSON.stringify({ ok:true, url, via:'rest_attachment' }), {
            status: 200, headers: { 'Content-Type':'application/json', ...CORS }
          });
        }
      }
    } catch (e:any) {
      restAttachment = { ok: false, status: 0, body: { error: e?.message || 'attachment_b64_failed' } };
    }

    // rien n'a marchÃ© â†’ on renvoie TOUT le diagnostic
    const debug = {
      gqlUserErrors,
      restSource,
      restAttachment,
    };
    console.error('finish debug:', JSON.stringify(debug, null, 2)); // visible dans les logs Vercel

    return new Response(JSON.stringify({ ok:false, error:'file_create_failed', debug }), {
      status: 400, headers: { 'Content-Type':'application/json', ...CORS }
    });

  } catch (e:any) {
    return new Response(JSON.stringify({ ok:false, error: e?.message || 'finish_failed' }), {
      status: 500, headers: { 'Content-Type':'application/json', ...CORS }
    });
  }
}

