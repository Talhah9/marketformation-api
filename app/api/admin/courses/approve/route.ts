import { handleOptions, jsonWithCors } from '@/app/api/_lib/cors';

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
function getShopDomain() {
  return process.env.SHOP_DOMAIN || '';
}

async function shopifyFetch(path: string, init?: RequestInit & { json?: any }) {
  const domain = getShopDomain();
  if (!domain) throw new Error('Missing env SHOP_DOMAIN');

  const base = `https://${domain}/admin/api/2024-07`;
  const headers: Record<string, string> = {
    'X-Shopify-Access-Token': getAdminToken(),
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  const res = await fetch(base + path, {
    method: init?.method || (init?.json ? 'POST' : 'GET'),
    headers,
    body: init?.json ? JSON.stringify(init.json) : undefined,
    cache: 'no-store',
  });

  const text = await res.text();
  let json: any = {};
  try { json = text ? JSON.parse(text) : {}; } catch {}
  return { ok: res.ok, status: res.status, json, text };
}

async function upsertProductMetafield(
  productId: number,
  namespace: string,
  key: string,
  type: string,
  value: string,
) {
  return shopifyFetch(`/metafields.json`, {
    json: {
      metafield: {
        namespace,
        key,
        type,
        value,
        owner_resource: 'product',
        owner_id: productId,
      },
    },
  });
}

function isAdmin(req: Request) {
  const email = String(req.headers.get('x-mf-admin-email') || '').toLowerCase();
  return email === 'talhahally974@gmail.com';
}

function extractNumericIdFromGid(gid: string) {
  // gid://shopify/Product/123
  const m = String(gid || '').match(/gid:\/\/shopify\/Product\/(\d+)/);
  return m ? m[1] : '';
}

export async function OPTIONS(req: Request) {
  return handleOptions(req);
}

export async function POST(req: Request) {
  try {
    if (!process.env.SHOP_DOMAIN || !getAdminToken()) {
      return jsonWithCors(req, { ok: false, error: 'Missing SHOP_DOMAIN or Admin token' }, { status: 500 });
    }
    if (!isAdmin(req)) {
      return jsonWithCors(req, { ok: false, error: 'admin_required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({} as any));
    const productId = String(body?.productId || '').trim();

    if (!productId) {
      return jsonWithCors(req, { ok: false, error: 'productId_required' }, { status: 400 });
    }

    const numeric = extractNumericIdFromGid(productId) || (productId.match(/^\d+$/) ? productId : '');
    if (!numeric) {
      return jsonWithCors(req, { ok: false, error: 'productId_must_be_gid_or_numeric' }, { status: 400 });
    }

    // ✅ Approved
    const r = await upsertProductMetafield(
      Number(numeric),
      'mfapp',
      'approval_status',
      'single_line_text_field',
      'approved',
    );

    if (!r.ok) {
      return jsonWithCors(req, { ok: false, error: `Shopify ${r.status}`, detail: r.text }, { status: r.status });
    }

    return jsonWithCors(req, { ok: true });
  } catch (e: any) {
    return jsonWithCors(req, { ok: false, error: e?.message || 'approve_failed' }, { status: 500 });
  }
}
