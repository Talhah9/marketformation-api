// app/proxy/payouts/summary/route.ts
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

  const base = `${url.protocol}//${url.host}`;
  const target = new URL('/api/payouts/summary', base);

  // IMPORTANT : ton /api/payouts/summary utilise getTrainerFromRequest()
  // donc on lui passe ce qu’il attend via headers
  const r = await fetch(target.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'x-trainer-id': shopifyCustomerId,
      'x-trainer-email': email,
    },
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
