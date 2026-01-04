import { handleOptions, jsonWithCors } from '@/app/api/_lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function ym(d = new Date()) {
  return String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, '0');
}

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
  value: string
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

function isAdminReq(req: Request) {
  const email = (req.headers.get('x-mf-admin-email') || '').toLowerCase().trim();
  const allow = (process.env.MF_ADMIN_EMAILS || 'talhahally974@gmail.com')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  return !!email && allow.includes(email);
}

export async function OPTIONS(req: Request) {
  return handleOptions(req);
}

export async function POST(req: Request) {
  try {
    if (!getShopDomain() || !getAdminToken()) {
      return jsonWithCors(req, { ok: false, error: 'Missing SHOP_DOMAIN or admin token' }, { status: 500 });
    }

    if (!isAdminReq(req)) {
      return jsonWithCors(req, { ok: false, error: 'admin_forbidden' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({} as any));

    const raw = String(body?.productId || '').trim();
    const m = raw.match(/(\d+)$/); // ✅ accepte "123" ou "gid://shopify/Product/123"
    const productId = m ? m[1] : '';

    if (!productId) {
      return jsonWithCors(req, { ok: false, error: 'productId_required' }, { status: 400 });
    }

    const pid = Number(productId);

    // 1) approval_status = approved
    await upsertProductMetafield(pid, 'mfapp', 'approval_status', 'single_line_text_field', 'approved');

    // 2) Publie le produit
    const r = await shopifyFetch(`/products/${pid}.json`, {
      method: 'PUT',
      json: { product: { id: pid, status: 'active' } },
    });
    if (!r.ok) {
      return jsonWithCors(req, { ok: false, error: `Shopify ${r.status}`, detail: r.text }, { status: r.status });
    }

    // 3) Bucket quota au moment de la vraie publication
    const bucket = ym();
    await upsertProductMetafield(pid, 'mfapp', 'published_YYYYMM', 'single_line_text_field', bucket);

    return jsonWithCors(req, { ok: true });
  } catch (e: any) {
    return jsonWithCors(req, { ok: false, error: e?.message || 'approve_failed' }, { status: 500 });
  }
}
