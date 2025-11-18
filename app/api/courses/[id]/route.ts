// app/api/courses/[id]/route.ts
import { handleOptions, jsonWithCors } from '@/app/api/_lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ============================================================
//   Shopify fetch helper
// ============================================================
function getAdminToken() {
  return (
    process.env.SHOP_ADMIN_TOKEN ||
    process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN ||
    process.env.ADMIN_TOKEN ||
    ''
  );
}

async function shopifyFetch(path: string, init?: RequestInit & { json?: any }) {
  const domain = process.env.SHOP_DOMAIN;
  if (!domain) throw new Error('Missing SHOP_DOMAIN');

  const url = `https://${domain}/admin/api/2024-07${path}`;

  const headers: Record<string, string> = {
    'X-Shopify-Access-Token': getAdminToken(),
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  const res = await fetch(url, {
    method: init?.method || (init?.json ? 'POST' : 'GET'),
    headers,
    body: init?.json ? JSON.stringify(init.json) : undefined,
    cache: 'no-store',
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}

  return { ok: res.ok, status: res.status, json, text };
}

// ============================================================
//   OPTIONS (préflight CORS)
// ============================================================
export async function OPTIONS(req: Request) {
  return handleOptions(req);
}

// ============================================================
//   DELETE /api/courses/:id
// ============================================================
export async function DELETE(req: Request, ctx: { params: { id: string } }) {
  const id = ctx.params.id;
  if (!id) {
    return jsonWithCors(req, { ok: false, error: 'missing_id' }, { status: 400 });
  }

  if (!process.env.SHOP_DOMAIN || !getAdminToken()) {
    return jsonWithCors(req, { ok: false, error: 'missing_env' }, { status: 500 });
  }

  try {
    const del = await shopifyFetch(`/products/${id}.json`, {
      method: 'DELETE',
    });

    if (!del.ok) {
      return jsonWithCors(
        req,
        { ok: false, error: `Shopify error`, detail: del.text },
        { status: del.status }
      );
    }

    return jsonWithCors(req, { ok: true, id });
  } catch (e: any) {
    return jsonWithCors(
      req,
      { ok: false, error: e?.message || 'delete_failed' },
      { status: 500 }
    );
  }
}
