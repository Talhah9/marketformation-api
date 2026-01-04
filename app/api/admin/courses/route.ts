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

async function getProductMetafieldValue(productId: number, namespace: string, key: string) {
  const r = await shopifyFetch(`/products/${productId}/metafields.json?limit=250`);
  if (!r.ok) return null;
  const arr = (r.json as any)?.metafields || [];
  const mf = arr.find((m: any) => m?.namespace === namespace && m?.key === key);
  return mf?.value ?? null;
}

// ✅ garde-fou minimal (UI + header). On renforcera via App Proxy ensuite.
function isAdmin(req: Request) {
  const email = String(req.headers.get('x-mf-admin-email') || '').toLowerCase();
  if (!email) return false;
  return email === 'talhahally974@gmail.com';
}

export async function OPTIONS(req: Request) {
  return handleOptions(req);
}

export async function GET(req: Request) {
  try {
    if (!process.env.SHOP_DOMAIN || !getAdminToken()) {
      return jsonWithCors(req, { ok: false, error: 'Missing SHOP_DOMAIN or Admin token' }, { status: 500 });
    }
    if (!isAdmin(req)) {
      return jsonWithCors(req, { ok: false, error: 'admin_required' }, { status: 403 });
    }

    // tes formations ont tag "mkt-course"
    const r = await shopifyFetch(`/products.json?limit=250&tag=mkt-course`);
    if (!r.ok) {
      return jsonWithCors(req, { ok: false, error: `Shopify ${r.status}`, detail: r.text }, { status: r.status });
    }

    const products = (r.json as any)?.products || [];

    const items = await Promise.all(
      products.map(async (p: any) => {
        const approvalRaw = await getProductMetafieldValue(p.id, 'mfapp', 'approval_status');
        const approval_status = String(approvalRaw || 'pending').trim().toLowerCase();

        const price = p?.variants?.[0]?.price ?? null;

        return {
          product_id: `gid://shopify/Product/${p.id}`, // pour approve route
          id: p.id,
          title: p.title,
          trainer_name: p.vendor || '—',
          price_label: price != null ? `${price} €` : '—',
          price_eur: price != null ? Number(price) : null,
          sales_count: null,
          approval_status,
          status_label: approval_status === 'approved' ? 'Approuvée' : 'En attente',
          handle: p.handle || '',
          published: !!p.published_at,
          published_at: p.published_at || null,
          created_at: p.created_at || null,
        };
      })
    );

    return jsonWithCors(req, { ok: true, items });
  } catch (e: any) {
    return jsonWithCors(req, { ok: false, error: e?.message || 'admin_list_failed' }, { status: 500 });
  }
}
