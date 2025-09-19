import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function withCORS(req: Request, res: NextResponse, methods = 'POST,OPTIONS') {
  const origin = req.headers.get('origin') || process.env.CORS_ORIGIN || 'https://tqiccz-96.myshopify.com';
  res.headers.set('Access-Control-Allow-Origin', origin);
  res.headers.set('Vary', 'Origin');
  res.headers.set('Access-Control-Allow-Methods', methods);
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  return res;
}

export async function OPTIONS(req: Request) {
  return withCORS(req, new NextResponse(null, { status: 204 }));
}

// On ne génère plus d’URL d’upload côté client : on renvoie 410 pour indiquer que l’endpoint est obsolète.
export async function POST(req: Request) {
  return withCORS(req, NextResponse.json({ error: 'client-upload disabled; use /api/upload/pdf' }, { status: 410 }));
}

export async function GET(req: Request) {
  return withCORS(req, NextResponse.json({ ok: true, route: 'upload/pdf/start (disabled)' }, { status: 200 }));
}
