// app/api/upload/pdf/start/route.ts
import { NextResponse } from 'next/server';
import { generateUploadURL } from '@vercel/blob'; // ✅ version 0.23.4 requise

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_ORIGIN =
  process.env.CORS_ORIGIN || 'https://tqiccz-96.myshopify.com';

function withCORS(req: Request, res: NextResponse, methods = 'POST,OPTIONS') {
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
  // simple ping pour debug
  return withCORS(
    req,
    NextResponse.json({ ok: true, route: 'upload/pdf/start' }, { status: 200 })
  );
}

export async function POST(req: Request) {
  try {
    // (optionnel) stricter CORS: refuse origins non autorisés
    const origin = req.headers.get('origin') || '';
    if (ALLOWED_ORIGIN && origin && origin !== ALLOWED_ORIGIN) {
      return withCORS(
        req,
        NextResponse.json({ ok: false, error: 'Origin not allowed' }, { status: 403 })
      );
    }

    // La v0.23.4 lit le token RW via env (config projet Blob)
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

    // (facultatif) log de la version réellement chargée (utile si souci de version en prod)
    try {
      // @ts-ignore
      const pkg = await import('@vercel/blob/package.json');
      console.log('[blob version]', pkg?.version);
    } catch {}

    const { url } = await generateUploadURL({
      // 🔒 n’autoriser que des PDF
      allowedContentTypes: ['application/pdf'],
      // 🔼 taille max confortable (peut être réduite)
      maximumSize: 100 * 1024 * 1024, // 100 Mo
      // suffixe aléatoire pour éviter collisions
      addRandomSuffix: true,
      // métadonnée libre (visible côté dashboard)
      tokenPayload: { scope: 'mf/pdf' },
    });

    return withCORS(
      req,
      NextResponse.json({ ok: true, uploadUrl: url }, { status: 200 })
    );
  } catch (e: any) {
    console.error('[upload/pdf/start] generateUploadURL error:', e);
    return withCORS(
      req,
      NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
    );
  }
}
