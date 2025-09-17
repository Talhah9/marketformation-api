// app/api/_lib/cors.ts
import { NextResponse } from 'next/server';

const ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

export function isAllowedOrigin(origin: string | null) {
  if (!origin) return false;
  // exact match contre la liste
  if (ORIGINS.includes(origin)) return true;
  // autorise *.myshopify.com si tu le souhaites:
  try {
    const u = new URL(origin);
    return u.hostname.endsWith('.myshopify.com');
  } catch {
    return false;
  }
}

function setCorsHeaders(res: NextResponse, origin: string | null) {
  if (isAllowedOrigin(origin)) res.headers.set('Access-Control-Allow-Origin', origin!);
  res.headers.set('Vary', 'Origin');
  res.headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
  res.headers.set('Access-Control-Max-Age', '86400');
  res.headers.set('Cache-Control', 'no-store');
}

export function handleOptions(req: Request) {
  const res = new NextResponse(null, { status: 204 });
  setCorsHeaders(res, req.headers.get('origin'));
  return res;
}

export function jsonWithCors(req: Request, data: any, init?: ResponseInit) {
  const res = NextResponse.json(data, { status: init?.status ?? 200, headers: init?.headers });
  setCorsHeaders(res, req.headers.get('origin'));
  return res;
}
