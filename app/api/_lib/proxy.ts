// app/api/_lib/proxy.ts
import crypto from 'crypto';
import type { NextRequest } from 'next/server';

export function verifyShopifyAppProxy(req: NextRequest): boolean {
  const secret =
    process.env.APP_PROXY_SHARED_SECRET ||
    process.env.SHOPIFY_APP_PROXY_SHARED_SECRET ||
    '';

  if (!secret) return false;

  const url = new URL(req.url);
  const signature = url.searchParams.get('signature') || '';
  if (!signature) return false;

  // Build message: sort all params except "signature"
  const pairs: string[] = [];
  url.searchParams.forEach((value, key) => {
    if (key === 'signature') return;
    pairs.push(`${key}=${value}`);
  });
  pairs.sort();
  const message = pairs.join('');

  const digest = crypto
    .createHmac('sha256', secret)
    .update(message, 'utf8')
    .digest('hex');

  // ✅ TS-safe timing compare (no Buffer)
  const enc = new TextEncoder();
  const a = enc.encode(digest);
  const b = enc.encode(signature);

  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
