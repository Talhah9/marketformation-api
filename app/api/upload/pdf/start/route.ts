// app/api/upload/pdf/start/route.ts
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || 'https://tqiccz-96.myshopify.com';

function withCORS(req: Request, res: NextResponse, methods = 'OPTIONS,GET,POST') {
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

// Ping de debug
export async function GET(req: Request) {
  return withCORS(req, NextResponse.json({ ok: true, route: 'upload/pdf/start (disabled)' }, { status: 200 }));
}

// On désactive POST pour éviter l’appel à generateUploadURL en prod
export async function POST(req: Request) {
  return withCORS(
    req,
    NextResponse.json({ ok: false, error: 'Direct-upload disabled. Use /api/upload/pdf.' }, { status: 410 })
  );
}
