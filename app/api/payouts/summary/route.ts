// app/proxy/payouts/summary/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { verifyShopifyAppProxy, proxyCorsHeaders } from '@/app/api/_lib/proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: proxyCorsHeaders(req.headers.get('origin')) });
}

export async function GET(req: NextRequest) {
  const headers = proxyCorsHeaders(req.headers.get('origin'));

  if (!verifyShopifyAppProxy(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401, headers });
  }

  const u = new URL(req.url);
  const email = (u.searchParams.get('email') || '').trim();
  const shopifyCustomerId = (u.searchParams.get('shopifyCustomerId') || '').trim();

  const base = `${u.protocol}//${u.host}`;
  const target = new URL('/api/payouts/summary', base);
  if (email) target.searchParams.set('email', email);
  if (shopifyCustomerId) target.searchParams.set('shopifyCustomerId', shopifyCustomerId);

  const r = await fetch(target.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });

  const text = await r.text();
  return new NextResponse(text, {
    status: r.status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}
