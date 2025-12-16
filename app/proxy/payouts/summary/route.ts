// app/api/_lib/proxy.ts
import crypto from 'crypto';
import type { NextRequest } from 'next/server';

function getProxySecret() {
  return (
    process.env.APP_PROXY_SHARED_SECRET ||
    process.env.SHOPIFY_APP_PROXY_SECRET ||
    ''
  );
}

export function verifyShopifyAppProxy(req: NextRequest): boolean {
  const secret = getProxySecret();
  if (!secret) return false;

  const url = new URL(req.url);
  const sig = url.searchParams.get('signature') || '';
  if (!sig) return false;

  // message = query params (sans signature), triés par key, concat "k=v"
  const pairs: Array<[string, string]> = [];
  url.searchParams.forEach((value, key) => {
    if (key === 'signature') return;
    pairs.push([key, value]);
  });
  pairs.sort((a, b) => a[0].localeCompare(b[0]));
  const message = pairs.map(([k, v]) => `${k}=${v}`).join('');

  const digestHex = crypto
    .createHmac('sha256', secret)
    .update(message)
    .digest('hex');

  // TS-safe timing compare
  const a = Buffer.from(digestHex, 'hex');
  const b = Buffer.from(sig, 'hex');
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(new Uint8Array(a), new Uint8Array(b));
}
