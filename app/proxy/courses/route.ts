// app/proxy/courses/route.ts
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function safeEqualHex(a: string, b: string) {
  // timingSafeEqual exige même longueur
  if (a.length !== b.length) return false;

  // Uint8Array = ArrayBufferView (TS happy)
  const ua = new Uint8Array(Buffer.from(a, 'utf8'));
  const ub = new Uint8Array(Buffer.from(b, 'utf8'));
  return crypto.timingSafeEqual(ua, ub);
}

/** Vérifie la signature App Proxy Shopify */
function verifyProxyHmac(req: NextRequest) {
  const secret = process.env.APP_PROXY_SHARED_SECRET || '';
  if (!secret) return false;

  const url = new URL(req.url);
  const params = new URLSearchParams(url.search);

  const provided = params.get('hmac') || '';
  params.delete('hmac');
  params.delete('signature'); // legacy

  const message = params.toString();
  const digest = crypto.createHmac('sha256', secret).update(message).digest('hex');

  try {
    return safeEqualHex(digest, provided);
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  if (!verifyProxyHmac(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const incoming = new URL(req.url);

  const email = (incoming.searchParams.get('email') || '').trim();
  const shopifyCustomerId = (incoming.searchParams.get('shopifyCustomerId') || '').trim();

  const base = `${incoming.protocol}//${incoming.host}`;
  const target = new URL(`${base}/api/courses`);
  if (email) target.searchParams.set('email', email);
  if (shopifyCustomerId) target.searchParams.set('shopifyCustomerId', shopifyCustomerId);

  const r = await fetch(target.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });

  const text = await r.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { ok: false, error: 'bad_json', raw: text };
  }

  return NextResponse.json(json, { status: r.status });
}
