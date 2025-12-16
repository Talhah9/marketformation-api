// app/proxy/ping/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { verifyShopifyAppProxy } from '@/app/api/_lib/proxy';

export async function GET(req: NextRequest) {
  const v = verifyShopifyAppProxy(req);
  if (!v.ok) return NextResponse.json({ ok: false, error: v.error }, { status: 401 });

  return NextResponse.json({ ok: true, pong: true, ts: Date.now() }, { status: 200 });
}
