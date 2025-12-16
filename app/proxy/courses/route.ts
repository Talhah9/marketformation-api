// app/proxy/courses/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { verifyShopifyAppProxy } from '@/app/api/_lib/proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getAdminToken() {
  return (
    process.env.SHOP_ADMIN_TOKEN ||
    process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN ||
    process.env.ADMIN_TOKEN ||
    ''
  );
}

async function shopifyAdminFetch(path: string) {
  const domain = process.env.SHOP_DOMAIN;
  const token = getAdminToken();
  if (!domain) throw new Error('Missing env SHOP_DOMAIN');
  if (!token) throw new Error('Missing admin token');

  const res = await fetch(`https://${domain}/admin/api/2024-07${path}`, {
    method: 'GET',
    headers: {
      'X-Shopify-Access-Token': token,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  const text = await res.text();
  let json: any = {};
  try { json = text ? JSON.parse(text) : {}; } catch {}
  return { ok: res.ok, status: res.status, json, text };
}

export async function GET(req: NextRequest) {
  try {
    // ✅ 1) signature App Proxy
    if (!verifyShopifyAppProxy(req)) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }

    const url = new URL(req.url);
    const customerId =
      url.searchParams.get('logged_in_customer_id') ||
      url.searchParams.get('customer_id') ||
      '';

    if (!customerId) {
      return NextResponse.json({ ok: true, items: [], plan: 'Unknown', quota: null }, { status: 200 });
    }

    // ✅ 2) resolve email via Shopify Admin API
    const c = await shopifyAdminFetch(`/customers/${encodeURIComponent(customerId)}.json`);
    if (!c.ok) {
      return NextResponse.json(
        { ok: false, error: `shopify_customer_${c.status}`, detail: c.text },
        { status: 502 },
      );
    }

    const email = (c.json as any)?.customer?.email || '';
    if (!email) {
      return NextResponse.json({ ok: true, items: [], plan: 'Unknown', quota: null }, { status: 200 });
    }

    // ✅ 3) call your internal API (same deployment)
    const base = `${url.protocol}//${url.host}`;
    const apiUrl = new URL(`${base}/api/courses`);
    apiUrl.searchParams.set('email', email);
    apiUrl.searchParams.set('shopifyCustomerId', String(customerId));

    const r = await fetch(apiUrl.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });

    const data = await r.json().catch(() => ({}));
    return NextResponse.json(data, { status: r.status });
  } catch (e: any) {
    console.error('[MF] /proxy/courses error', e);
    return NextResponse.json({ ok: false, error: e?.message || 'server_error' }, { status: 500 });
  }
}
