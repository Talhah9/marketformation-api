// app/api/upload/image/route.ts
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

const ACCEPTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB

function pickOrigin(reqOrigin?: string | null): string {
  const o = (reqOrigin || '').trim();
  if (o && ALLOW_ORIGINS.includes(o)) return o;
  // fallback: premier origin autorisé (ou * si vraiment besoin — ici on reste strict)
  return ALLOW_ORIGINS[0] || DEFAULT_SHOP_ORIGIN;
}

function withCORS(res: Response, originHeader?: string | null) {
  const origin = pickOrigin(originHeader);
  const r = new Response(res.body, res);
  r.headers.set('Access-Control-Allow-Origin', origin);
  r.headers.set('Access-Control-Allow-Methods', ALLOW_METHODS);
  r.headers.set('Access-Control-Allow-Headers', ALLOW_HEADERS);
  // r.headers.set('Access-Control-Allow-Credentials', 'true'); // active si nécessaire
  r.headers.set('Vary', 'Origin');
  return r;
}

export async function OPTIONS(req: Request) {
  return withCORS(new Response(null, { status: 204 }), req.headers.get('origin'));
}

// Edge marche aussi ; on aligne sur pdf => nodejs
export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const originHdr = req.headers.get('origin');

    // 1) multipart requis
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
    const file = form.get('image');
    if (!(file instanceof File)) {
      return withCORS(
        new Response(JSON.stringify({ ok: false, error: 'image field missing' }), {
          status: 400, headers: { 'Content-Type': 'application/json' }
        }),
        originHdr
      );
    }

    // 3) validations simples
    const mime = (file as any).type || '';
    const size = (file as any).size || 0;
    if (mime && !ACCEPTED_TYPES.has(mime)) {
      return withCORS(
        new Response(JSON.stringify({ ok: false, error: 'Only PNG, JPG or WEBP allowed' }), {
          status: 415, headers: { 'Content-Type': 'application/json' }
        }),
        originHdr
      );
    }
    if (size && size > MAX_SIZE_BYTES) {
      return withCORS(
        new Response(JSON.stringify({ ok: false, error: 'File too large' }), {
          status: 413, headers: { 'Content-Type': 'application/json' }
        }),
        originHdr
      );
    }

    // 4) upload vers vercel/blob (BLOB_READ_WRITE_TOKEN requis en prod)
    const safeName = ((file as any).name || 'image').replace(/[^\w.\-]/g, '_');
    const filename = `mf/images/${Date.now()}-${safeName}`;

    const putRes = await put(filename, file, {
      access: 'public',
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
    // 6) erreurs → garder CORS
    return withCORS(
      new Response(JSON.stringify({ ok: false, error: e?.message || 'upload_failed' }), {
        status: 500, headers: { 'Content-Type': 'application/json' }
      }),
      undefined
    );
  }
}
