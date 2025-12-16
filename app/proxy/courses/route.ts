// app/proxy/courses/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { verifyShopifyAppProxy } from '@/app/api/_lib/proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!verifyShopifyAppProxy(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const email = url.searchParams.get('email') || '';
  const shopifyCustomerId = url.searchParams.get('shopifyCustomerId') || '';

  // Forward to internal API
  const base = `${url.protocol}//${url.host}`;
  const target = new URL('/api/courses', base);
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
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}
