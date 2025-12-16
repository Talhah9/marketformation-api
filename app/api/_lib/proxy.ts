// app/api/_lib/proxy.ts
import { NextRequest } from 'next/server';
import { createHmac } from 'crypto';

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

export function verifyShopifyAppProxy(req: NextRequest): boolean {
  const secret =
    process.env.APP_PROXY_SHARED_SECRET ||
    process.env.SHOPIFY_APP_PROXY_SECRET ||
    '';

  if (!secret) return false;

  const url = new URL(req.url);
  const signature = url.searchParams.get('signature') || '';
  if (!signature) return false;

  // Rebuild message = concat key=value (sorted) excluding signature
  const entries: Array<[string, string]> = [];
  url.searchParams.forEach((value, key) => {
    if (key === 'signature') return;
    entries.push([key, value]);
  });
  entries.sort((a, b) => a[0].localeCompare(b[0]));

  const message = entries.map(([k, v]) => `${k}=${v}`).join('');

  const digest = createHmac('sha256', secret).update(message, 'utf8').digest('hex');

  return timingSafeEqualStr(digest, signature);
}

export function proxyCorsHeaders(origin?: string | null) {
  const o = origin || '*';
  return {
    'Access-Control-Allow-Origin': o,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers':
      'Origin, Accept, Content-Type, Authorization, X-Requested-With',
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin',
  };
}
