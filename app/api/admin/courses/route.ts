// app/api/admin/courses/route.ts
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

async function shopifyGraphql(query: string, variables?: any) {
  const domain = getShopDomain();
  if (!domain) throw new Error('Missing env SHOP_DOMAIN');

  const endpoint = `https://${domain}/admin/api/2024-07/graphql.json`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': getAdminToken(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ query, variables: variables || {} }),
    cache: 'no-store',
  });

  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {}

  return { ok: res.ok, status: res.status, json, text };
}

// ✅ garde-fou minimal (UI + header). On renforcera via App Proxy ensuite.
function isAdmin(req: Request) {
  const email = String(req.headers.get('x-mf-admin-email') || '').toLowerCase().trim();
  if (!email) return false;
  return email === 'talhahally974@gmail.com';
}

function numIdFromGid(gid: string) {
  const m = String(gid || '').match(/\/Product\/(\d+)$/);
  return m ? m[1] : '';
}

// ✅ parse int safe (metafield number stored as string)
function toIntSafe(v: any) {
  const n = parseInt(String(v ?? '').trim(), 10);
  return Number.isFinite(n) ? n : 0;
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

    // ✅ 1 seule requête: produits + metafields nécessaires
    // NB: on filtre sur tag "mkt-course"
    const q = `
      query AdminCourses($q: String!) {
        products(first: 250, query: $q) {
          edges {
            node {
              id
              title
              handle
              status
              createdAt
              publishedAt
              vendor
              featuredImage { url }

              variants(first: 1) {
                edges { node { price } }
              }

              approval: metafield(namespace:"mfapp", key:"approval_status") { value }
              theme: metafield(namespace:"mfapp", key:"theme") { value }
              sales: metafield(namespace:"mfapp", key:"sales_count") { value }
            }
          }
        }
      }
    `;

    // Shopify search query
    const search = `tag:"mkt-course"`;
    const r = await shopifyGraphql(q, { q: search });

    if (!r.ok) {
      return jsonWithCors(
        req,
        { ok: false, error: `Shopify ${r.status}`, detail: r.text },
        { status: r.status },
      );
    }

    const edges = r.json?.data?.products?.edges || [];
    const items = edges.map((e: any) => {
      const p = e?.node || {};
      const gid = String(p.id || '');
      const idDigits = numIdFromGid(gid);

      const approval_status = String(p?.approval?.value || 'pending').trim().toLowerCase();
      const status_label =
        approval_status === 'approved'
          ? 'Approuvée'
          : approval_status === 'rejected'
          ? 'Refusée'
          : 'En attente';

      const priceRaw = p?.variants?.edges?.[0]?.node?.price ?? null;
      const price_eur = priceRaw != null && priceRaw !== '' ? Number(priceRaw) : null;

      return {
        // ✅ IMPORTANT: ton front utilise product_id / productId / id
        // ✅ BIGINT safe: id reste string (jamais Number())
        product_id: gid,
        productId: gid,
        id: idDigits || gid,

        title: p.title || '',
        trainer_name: p.vendor || '—',

        price_label: priceRaw != null && priceRaw !== '' ? `${priceRaw} €` : '—',
        price_eur: Number.isFinite(price_eur as any) ? price_eur : null,

        // ✅ connecté via metafield mfapp.sales_count (number_integer)
        sales_count: toIntSafe(p?.sales?.value),

        approval_status,
        status_label,

        handle: p.handle || '',
        published: !!p.publishedAt,
        published_at: p.publishedAt || null,
        created_at: p.createdAt || null,

        // optionnels
        image_url: p?.featuredImage?.url || '',
        mf_theme: String(p?.theme?.value || '').trim(),
        shopify_status: p.status || null,
      };
    });

    return jsonWithCors(req, { ok: true, items });
  } catch (e: any) {
    return jsonWithCors(req, { ok: false, error: e?.message || 'admin_list_failed' }, { status: 500 });
  }
}
