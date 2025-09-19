// app/api/upload/pdf/start/route.ts
import { NextResponse } from 'next/server';
import { createUploadUrl } from '@vercel/blob'; // si erreur d'import, essaye generateUploadURL

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || 'https://tqiccz-96.myshopify.com';

function withCORS(req: Request, res: NextResponse) {
  const origin = req.headers.get('origin') || '';
  res.headers.set('Access-Control-Allow-Origin', origin || ALLOWED_ORIGIN);
  res.headers.set('Vary', 'Origin');
  // pas besoin de credentials pour cette route, donc pas d’include côté front
  res.headers.set('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
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
    // Limites et type autorisé (adapte la taille si besoin)
    const { url } = await createUploadUrl({
      allowedContentTypes: ['application/pdf'],
      maximumSize: 50 * 1024 * 1024, // 50 MB
      tokenPayload: { scope: 'mf/pdf' },
    });
    return json(req, { ok: true, uploadUrl: url }, 200);
  } catch (e: any) {
    // Si ton package est ancien, createUploadUrl peut ne pas exister → utiliser generateUploadURL
    return json(req, { ok: false, error: e?.message || 'createUploadUrl failed' }, 500);
  }
}
