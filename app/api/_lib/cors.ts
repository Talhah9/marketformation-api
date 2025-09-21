import { NextResponse } from 'next/server';

const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || 'https://tqiccz-96.myshopify.com';

export function withCORS(req: Request, res: NextResponse, methods = 'GET,POST,OPTIONS') {
  const origin = req.headers.get('origin') || ALLOWED_ORIGIN;
  res.headers.set('Access-Control-Allow-Origin', origin);
  res.headers.set('Vary', 'Origin');
  res.headers.set('Access-Control-Allow-Methods', methods);
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  return res;
}

export function corsOptions(req: Request) {
  return withCORS(req, new NextResponse(null, { status: 204 }), 'GET,POST,OPTIONS');
}
