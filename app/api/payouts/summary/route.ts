// app/proxy/payouts/summary/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { verifyShopifyAppProxy } from '@/app/api/_lib/proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function cors(res: NextResponse, req: NextRequest) {
  const origin = req.headers.get('origin') || '*';
  res.headers.set('Access-Control-Allow-Origin', origin);
  res.headers.set('Access-Control-Allow-Credentials', 'true');
  res.headers.set('Vary', 'Origin');
  return res;
}

async function shopifyAdminFetch(path: string) {
  const domain = process.env.SHOP_DOMAIN;
  const token =
    process.env.SHOP_ADMIN_TOKEN ||
    process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN ||
    process.env.ADMIN_TOKEN ||
    '';

  if (!domain || !token) throw new Error('Missing SHOP_DOMAIN or Admin token');

  const base = `https://${domain}/admin/api/2024-07`;
  const r = await fetch(base + path, {
    method: 'GET',
    headers: {
      'X-Shopify-Access-Token': token,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  });

  const text = await r.text();
  let json: any = {};
  try { json = text ? JSON.parse(text) : {}; } catch {}
  return { ok: r.ok, status: r.status, json, text };
}

export async function OPTIONS(req: NextRequest) {
  return cors(new NextResponse(null, { status: 204 }), req);
}

export async function GET(req: NextRequest) {
  try {
    const auth = verifyShopifyAppProxy(req);
    if (!auth.ok) {
      return cors(
        NextResponse.json({ ok: false, error: 'unauthorized', reason: auth.reason }, { status: 401 }),
        req
      );
    }

    const customerId = auth.loggedInCustomerId;
    if (!customerId) {
      return cors(
        NextResponse.json({ ok: false, error: 'unauthorized', reason: 'missing_logged_in_customer_id' }, { status: 401 }),
        req
      );
    }

    // On récupère l’email pour ton auth interne (getTrainerFromRequest)
    const cr = await shopifyAdminFetch(`/customers/${encodeURIComponent(customerId)}.json`);
    if (!cr.ok) {
      return cors(
        NextResponse.json({ ok: false, error: 'customer_fetch_failed', detail: cr.text }, { status: cr.status }),
        req
      );
    }
    const email = String(cr.json?.customer?.email || '').trim();

    const u = new URL(req.url);
    const base = `${u.protocol}//${u.host}`;
    const forward = new URL(`${base}/api/payouts/summary`);

    const r = await fetch(forward.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'x-trainer-id': String(customerId),
        'x-trainer-email': email,
      },
      cache: 'no-store',
    });

    const data = await r.json().catch(() => ({}));
    return cors(NextResponse.json(data, { status: r.status }), req);
  } catch (e: any) {
    return cors(
      NextResponse.json({ ok: false, error: e?.message || 'server_error' }, { status: 500 }),
      req
    );
  }
}
