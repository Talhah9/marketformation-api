import { NextResponse } from 'next/server';
import { generateUploadURL } from '@vercel/blob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || 'https://tqiccz-96.myshopify.com';

function withCORS(req: Request, res: NextResponse, methods = 'POST,OPTIONS') {
  const origin = req.headers.get('origin') || ALLOWED_ORIGIN;
  res.headers.set('Access-Control-Allow-Origin', origin);
  res.headers.set('Vary', 'Origin');
  res.headers.set('Access-Control-Allow-Methods', methods);
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  return res;
}

export async function OPTIONS(req: Request) {
  return withCORS(req, new NextResponse(null, { status: 204 }));
}

export async function POST(req: Request) {
  try {
    // Sécurité: refuse si pas d’origin autorisé (optionnel)
    const origin = req.headers.get('origin') || '';
    if (ALLOWED_ORIGIN && origin && origin !== ALLOWED_ORIGIN) {
      return withCORS(req, NextResponse.json({ ok:false, error:'Origin not allowed' }, { status: 403 }));
    }

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      console.error('[upload/pdf/start] Missing BLOB_READ_WRITE_TOKEN');
      return withCORS(req, NextResponse.json({ ok:false, error:'Server misconfigured: missing blob token' }, { status: 500 }));
    }

    const { url } = await generateUploadURL({
      allowedContentTypes: ['application/pdf'],
      maximumSize: 100 * 1024 * 1024, // 100 Mo
      addRandomSuffix: true,
      tokenPayload: { scope: 'mf/pdf' },
    });

    return withCORS(req, NextResponse.json({ ok:true, uploadUrl: url }, { status: 200 }));
  } catch (e:any) {
    console.error('[upload/pdf/start] generateUploadURL error:', e);
    return withCORS(req, NextResponse.json({ ok:false, error: String(e?.message || e) }, { status: 500 }));
  }
}
