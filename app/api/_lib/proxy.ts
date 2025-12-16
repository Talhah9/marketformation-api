import crypto from 'crypto';

/**
 * Shopify App Proxy verification
 * signature = HMAC SHA256 (hex) du querystring "trié" SANS signature, concaténé en "k=v" (sans &)
 * secret = APP_PROXY_SHARED_SECRET
 */
export function verifyShopifyAppProxy(reqUrl: string, secret: string) {
  if (!secret) return false;

  const url = new URL(reqUrl);
  const signature = url.searchParams.get('signature') || '';
  if (!signature) return false;

  const pairs = Array.from(url.searchParams.entries())
    .filter(([k]) => k !== 'signature')
    .sort(([a], [b]) => a.localeCompare(b));

  const message = pairs.map(([k, v]) => `${k}=${v}`).join('');

  const digest = crypto.createHmac('sha256', secret).update(message).digest('hex');

  // ✅ Fix TS Buffer issue: TextEncoder => Uint8Array<ArrayBuffer>
  const enc = new TextEncoder();
  const a = enc.encode(digest);
  const b = enc.encode(signature);

  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}
