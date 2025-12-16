// app/api/_lib/proxy.ts
import { NextRequest } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';

export type ProxyAuth =
  | { ok: true; shop: string | null; loggedInCustomerId: string | null }
  | { ok: false; error: 'unauthorized'; reason: string };

function safeEq(a: string, b: string) {
  // ✅ Fix TS Buffer/ArrayBufferView : on compare des Uint8Array
  const aa = new Uint8Array(Buffer.from(a, 'utf8'));
  const bb = new Uint8Array(Buffer.from(b, 'utf8'));
  if (aa.length !== bb.length) return false;
  return timingSafeEqual(aa, bb);
}

export function verifyShopifyAppProxy(req: NextRequest): ProxyAuth {
  const secret =
    process.env.APP_PROXY_SHARED_SECRET ||
    process.env.SHOPIFY_APP_PROXY_SECRET ||
    '';

  if (!secret) {
    return { ok: false, error: 'unauthorized', reason: 'missing_APP_PROXY_SHARED_SECRET' };
  }

  const url = new URL(req.url);
  const params = Array.from(url.searchParams.entries());

  const signature = url.searchParams.get('signature') || '';
  if (!signature) {
    return { ok: false, error: 'unauthorized', reason: 'missing_signature' };
  }

  // Shopify App Proxy signing:
  // - take all query params except "signature"
  // - sort by key lexicographically
  // - concatenate as "key=value" (no separators)
  // - HMAC-SHA256 hex with shared secret
  const basePairs = params
    .filter(([k]) => k !== 'signature')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('');

  const computed = createHmac('sha256', secret).update(basePairs).digest('hex');

  if (!safeEq(computed, signature)) {
    return { ok: false, error: 'unauthorized', reason: 'bad_signature' };
  }

  return {
    ok: true,
    shop: url.searchParams.get('shop'),
    loggedInCustomerId: url.searchParams.get('logged_in_customer_id'),
  };
}
