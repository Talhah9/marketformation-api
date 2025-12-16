// app/api/_lib/proxy.ts
import crypto from 'crypto';
import { NextRequest } from 'next/server';

function toU8(s: string) {
  return new TextEncoder().encode(s);
}

function safeEqual(a: string, b: string) {
  // compare constant-time
  const aa = toU8(a);
  const bb = toU8(b);
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

/**
 * Vérifie la signature Shopify App Proxy.
 * Shopify calcule la signature sur :
 * - tous les query params SAUF "signature"
 * - triés par clé
 * - concaténés "key=value" (sans &)
 * HMAC-SHA256(secret) en HEX
 */
export function verifyShopifyAppProxy(req: NextRequest) {
  const secret =
    process.env.APP_PROXY_SHARED_SECRET ||
    process.env.SHOPIFY_APP_PROXY_SHARED_SECRET ||
    '';

  if (!secret) return { ok: false, error: 'missing_shared_secret' as const };

  const url = new URL(req.url);
  const signature = url.searchParams.get('signature') || '';

  if (!signature) return { ok: false, error: 'missing_signature' as const };

  const pairs = Array.from(url.searchParams.entries())
    .filter(([k]) => k !== 'signature')
    .sort(([a], [b]) => a.localeCompare(b));

  const message = pairs.map(([k, v]) => `${k}=${v}`).join('');

  const expected = crypto
    .createHmac('sha256', secret)
    .update(message)
    .digest('hex');

  const ok = safeEqual(expected, signature);
  return ok ? { ok: true as const } : { ok: false as const, error: 'bad_signature' as const };
}
