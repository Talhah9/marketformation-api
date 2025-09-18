import { NextResponse } from 'next/server';
import { createUploadUrl } from '@vercel/blob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || 'https://tqiccz-96.myshopify.com';

function withCORS(req: Request, res: NextResponse) {
  const origin = req.headers.get('origin') || '';
  res.headers.set('Access-Control-Allow-Origin', origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN);
  res.headers.set('Access-Control-Allow-Credentials', 'true');
  res.headers.set('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.headers.set('Vary', 'Origin');
  return res;
}

function json(req: Request, data: any, status = 200) {
  return withCORS(req, NextResponse.json(data, { status }));
}

export async function OPTIONS(req: Request) {
  return withCORS(req, new NextResponse(null, { status: 204 }));
}

export async function POST(req: Request) {
  try {
    // limite taille (ex: 50 Mo), et type PDF uniquement
    const { url, id } = await createUploadUrl({
      allowedContentTypes: ['application/pdf'],
      maximumSize: 50 * 1024 * 1024, // 50 MB
      tokenPayload: { scope: 'mf/pdf' }, // optionnel, juste pour tracer
    });

    // le client enverra le fichier vers `url` avec un simple PUT/POST
    return json(req, { ok: true, uploadUrl: url, id }, 200);
  } catch (e: any) {
    console.error('createUploadUrl error:', e);
    return json(req, { ok: false, error: e?.message || 'failed' }, 500);
  }
}
