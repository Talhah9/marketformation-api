// app/api/_lib/cors.ts
import { NextResponse } from 'next/server';

/**
 * Autorisations CORS centralisées.
 * - CORS_ORIGINS: liste d’origines autorisées, séparées par des virgules
 *   ex: "https://tqiccz-96.myshopify.com,https://www.tondomaine.com"
 * - CORS_ALLOW_SHOPIFY_WILDCARD=1 pour autoriser *.myshopify.com (optionnel)
 */
const ORIGINS = (process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const ALLOW_SHOPIFY_WILDCARD = process.env.CORS_ALLOW_SHOPIFY_WILDCARD === '1';

function isAllowedOrigin(origin: string | null) {
  if (!origin) return false;
  if (ORIGINS.includes(origin)) return true;
  if (ALLOW_SHOPIFY_WILDCARD) {
    try { return new URL(origin).hostname.endsWith('.myshopify.com'); }
    catch { return false; }
  }
  return false;
}

function setCors(res: NextResponse, origin: string | null) {
  if (isAllowedOrigin(origin)) res.headers.set('Access-Control-Allow-Origin', origin!);
  res.headers.set('Vary', 'Origin');
  res.headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
  res.headers.set('Access-Control-Max-Age', '86400');
  // Réponses API destinées au front → pas de cache navigateur
  if (!res.headers.has('Cache-Control')) res.headers.set('Cache-Control', 'no-store');
}

export function handleOptions(req: Request) {
  const res = new NextResponse(null, { status: 204 });
  setCors(res, req.headers.get('origin'));
  return res;
}

export function jsonWithCors(req: Request, data: any, init?: ResponseInit) {
  const res = NextResponse.json(data, { status: init?.status ?? 200, headers: init?.headers });
  setCors(res, req.headers.get('origin'));
  return res;
}
