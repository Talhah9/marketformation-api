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
  const { url } = await generateUploadURL({
    allowedContentTypes: ['application/pdf'],
    maximumSize: 100 * 1024 * 1024,
    addRandomSuffix: true,
    tokenPayload: { scope: 'mf/pdf' },
  });
  return withCORS(req, NextResponse.json({ ok: true, uploadUrl: url }, { status: 200 }));
}
