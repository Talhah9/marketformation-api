// app/api/upload/pdf/start/route.ts
import { NextResponse } from 'next/server';
import { generateUploadURL } from '@vercel/blob'; // ✅ au lieu de createUploadUrl

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || 'https://tqiccz-96.myshopify.com';

function withCORS(req: Request, res: NextResponse) {
  const origin = req.headers.get('origin') || ALLOWED_ORIGIN;
  res.headers.set('Access-Control-Allow-Origin', origin);
  res.headers.set('Vary', 'Origin');
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
    const { url } = await generateUploadURL({
      allowedContentTypes: ['application/pdf'],
      maximumSize: 100 * 1024 * 1024, // ex. 100 Mo
      tokenPayload: { scope: 'mf/pdf' },
    });
    return json(req, { ok: true, uploadUrl: url }, 200);
  } catch (e: any) {
    console.error('generateUploadURL error:', e);
    return json(req, { ok: false, error: e?.message || 'generateUploadURL failed' }, 500);
  }
}
