// app/api/upload/pdf/start/route.ts
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_ORIGIN =
  process.env.CORS_ORIGIN || 'https://tqiccz-96.myshopify.com';

function withCORS(req: Request, res: NextResponse, methods = 'POST,OPTIONS,GET') {
  const origin = req.headers.get('origin') || ALLOWED_ORIGIN;
  res.headers.set('Access-Control-Allow-Origin', origin);
  res.headers.set('Vary', 'Origin');
  res.headers.set('Access-Control-Allow-Methods', methods);
  res.headers.set(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Requested-With'
  );
  return res;
}

export async function OPTIONS(req: Request) {
  return withCORS(req, new NextResponse(null, { status: 204 }));
}

export async function GET(req: Request) {
  return withCORS(
    req,
    NextResponse.json({ ok: true, route: 'upload/pdf/start' }, { status: 200 })
  );
}

export async function POST(req: Request) {
  try {
    // CORS strict (optionnel)
    const origin = req.headers.get('origin') || '';
    if (ALLOWED_ORIGIN && origin && origin !== ALLOWED_ORIGIN) {
      return withCORS(
        req,
        NextResponse.json({ ok: false, error: 'Origin not allowed' }, { status: 403 })
      );
    }

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      console.error('[upload/pdf/start] Missing BLOB_READ_WRITE_TOKEN');
      return withCORS(
        req,
        NextResponse.json(
          { ok: false, error: 'Server misconfigured: missing blob token' },
          { status: 500 }
        )
      );
    }

    // === Import DYNAMIQUE pour être compatible v0.x et v1.x ===
    // (évite l’erreur de build “Attempted import error”)
    const blobMod: any = await import('@vercel/blob').catch(() => ({}));
    // Essaye toutes les variantes “connues”
    const gen =
      blobMod.generateUploadURL ||
      blobMod.createUploadURL ||
      blobMod.getUploadURL ||
      null;

    // Pour debug, on tente de récupérer la version réelle
    let blobVersion = 'unknown';
    try {
      const pkg: any = await import('@vercel/blob/package.json');
      blobVersion = pkg?.version || 'unknown';
    } catch {}

    if (typeof gen !== 'function') {
      console.error(
        '[upload/pdf/start] No generate/create upload URL function found in @vercel/blob',
        { blobVersion, keys: Object.keys(blobMod || {}) }
      );
      return withCORS(
        req,
        NextResponse.json(
          {
            ok: false,
            error:
              'This @vercel/blob version does not expose a “generateUploadURL/createUploadURL/getUploadURL” function',
            blobVersion,
          },
          { status: 500 }
        )
      );
    }

    // Appel de la fonction détectée
    // (La signature la plus courante accepte un objet d’options)
    const opts = {
      allowedContentTypes: ['application/pdf'],
      maximumSize: 100 * 1024 * 1024, // 100 Mo
      addRandomSuffix: true,
      tokenPayload: { scope: 'mf/pdf' },
    };

    const out = await gen(opts);
    // Certaines versions renvoient { url }, d’autres { uploadUrl } — on normalise
    const uploadUrl = out?.url || out?.uploadUrl;

    if (!uploadUrl) {
      console.error('[upload/pdf/start] No uploadUrl in response', { out, blobVersion });
      return withCORS(
        req,
        NextResponse.json(
          { ok: false, error: 'No uploadUrl returned by blob SDK', blobVersion },
          { status: 500 }
        )
      );
    }

    return withCORS(
      req,
      NextResponse.json({ ok: true, uploadUrl, blobVersion }, { status: 200 })
    );
  } catch (e: any) {
    console.error('[upload/pdf/start] error:', e);
    return withCORS(
      req,
      NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
    );
  }
}
