// app/proxy/courses/route.ts
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function verifyAppProxySignature(url: URL): boolean {
  const secret =
    process.env.APP_PROXY_SHARED_SECRET ||
    process.env.SHOPIFY_APP_PROXY_SHARED_SECRET ||
    '';

  if (!secret) return false;

  const signature = (url.searchParams.get('signature') || '').trim();
  if (!signature) return false;

  // params sans signature, triés
  const pairs: string[] = [];
  url.searchParams.forEach((value, key) => {
    if (key === 'signature') return;
    pairs.push(`${key}=${value}`);
  });
  pairs.sort((a, b) => a.localeCompare(b));

  const message = pairs.join('&');
  const digest = crypto.createHmac('sha256', secret).update(message).digest('hex');

  // ✅ comparaison simple (évite Buffer / timingSafeEqual)
  return digest.toLowerCase() === signature.toLowerCase();
}

function withCors(res: NextResponse, req: NextRequest) {
  const origin = req.headers.get('origin') || '*';
  res.headers.set('Access-Control-Allow-Origin', origin);
  res.headers.set('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Origin, Accept, Content-Type, Authorization');
  res.headers.set('Access-Control-Allow-Credentials', 'true');
  res.headers.set('Vary', 'Origin');
  return res;
}

export async function OPTIONS(req: NextRequest) {
  return withCors(new NextResponse(null, { status: 204 }), req);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);

  if (!verifyAppProxySignature(url)) {
    return withCors(
      NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 }),
      req,
    );
  }

  const email = url.searchParams.get('email') || '';
  const shopifyCustomerId = url.searchParams.get('shopifyCustomerId') || '';

  // forward vers /api/courses (server-side)
  const base = `${url.protocol}//${url.host}`;
  const target = new URL(`${base}/api/courses`);
  if (email) target.searchParams.set('email', email);
  if (shopifyCustomerId) target.searchParams.set('shopifyCustomerId', shopifyCustomerId);

  const r = await fetch(target.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });

  const data = await r.json().catch(() => ({}));
  return withCors(NextResponse.json(data, { status: r.status }), req);
}
