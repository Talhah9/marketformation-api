// app/api/upload/pdf/route.ts
import { put } from '@vercel/blob'

// --- CORS config pilotée par ENV ---
// CORS_ORIGINS: liste de origins séparés par des virgules (ex: "https://topaz.myshopify.com,https://autre.myshopify.com")
// SHOP_DOMAIN  : fallback (ex: "topaz.myshopify.com")
const DEFAULT_SHOP_ORIGIN =
  process.env.SHOP_DOMAIN ? `https://${process.env.SHOP_DOMAIN}` : 'https://tqiccz-96.myshopify.com';

const ALLOW_ORIGINS: string[] =
  (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

if (!ALLOW_ORIGINS.length && DEFAULT_SHOP_ORIGIN) {
  ALLOW_ORIGINS.push(DEFAULT_SHOP_ORIGIN);
}

const ALLOW_METHODS = 'POST, OPTIONS';
const ALLOW_HEADERS = 'Origin, Accept, Content-Type, Authorization';

function pickOrigin(reqOrigin?: string | null): string {
  const o = (reqOrigin || '').trim();
  if (o && ALLOW_ORIGINS.includes(o)) return o;
  return ALLOW_ORIGINS[0] || DEFAULT_SHOP_ORIGIN;
}

function withCORS(res: Response, originHeader?: string | null) {
  const origin = pickOrigin(originHeader);
  const r = new Response(res.body, res);
  r.headers.set('Access-Control-Allow-Origin', origin);
  r.headers.set('Access-Control-Allow-Methods', ALLOW_METHODS);
  r.headers.set('Access-Control-Allow-Headers', ALLOW_HEADERS);
  r.headers.set('Vary', 'Origin');
  return r;
}

export async function OPTIONS(req: Request) {
  return withCORS(new Response(null, { status: 204 }), req.headers.get('origin'));
}

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const originHdr = req.headers.get('origin');

  try {
    // 1) content-type doit être multipart/form-data
    const ctype = req.headers.get('content-type') || '';
    if (!ctype.includes('multipart/form-data')) {
      return withCORS(
        new Response(JSON.stringify({ ok: false, error: 'multipart/form-data required' }), {
          status: 400, headers: { 'Content-Type': 'application/json' }
        }),
        originHdr
      );
    }

    // 2) récupérer le fichier
    const form = await req.formData();
    const file = form.get('pdf');
    if (!(file instanceof File)) {
      return withCORS(
        new Response(JSON.stringify({ ok: false, error: 'pdf field missing' }), {
          status: 400, headers: { 'Content-Type': 'application/json' }
        }),
        originHdr
      );
    }

    // 3) (optionnel) vérifier le type
    if ((file as any).type && (file as any).type !== 'application/pdf') {
      return withCORS(
        new Response(JSON.stringify({ ok: false, error: 'Only application/pdf allowed' }), {
          status: 415, headers: { 'Content-Type': 'application/json' }
        }),
        originHdr
      );
    }

    // (optionnel) limite de taille alignée sur image (15MB)
    const size = (file as any).size || 0;
    const MAX_SIZE_BYTES = 15 * 1024 * 1024;
    if (size && size > MAX_SIZE_BYTES) {
      return withCORS(
        new Response(JSON.stringify({ ok: false, error: 'File too large' }), {
          status: 413, headers: { 'Content-Type': 'application/json' }
        }),
        originHdr
      );
    }

    // 4) upload — vercel/blob (BLOB_READ_WRITE_TOKEN requis en prod)
    const safeName = ((file as any).name || 'file.pdf').replace(/[^\w.\-]/g, '_');
    const filename = `mf/pdf/${Date.now()}-${safeName}`;
    const putRes = await put(filename, file, {
      access: 'public',   // passe en 'private' si tu gères des liens signés
      addRandomSuffix: true,
    });

    // 5) réponse OK + CORS
    return withCORS(
      new Response(JSON.stringify({ ok: true, url: putRes.url }), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      }),
      originHdr
    );
  } catch (e: any) {
    return withCORS(
      new Response(JSON.stringify({ ok: false, error: e?.message || 'upload_failed' }), {
        status: 500, headers: { 'Content-Type': 'application/json' }
      })
    );
  }
}
