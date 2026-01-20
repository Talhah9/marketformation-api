// app/api/admin/overview/route.ts
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
  try { json = text ? JSON.parse(text) : {}; } catch {}
  return { ok: res.ok, status: res.status, json, text };
}

function isAdmin(req: Request) {
  const email = String(req.headers.get('x-mf-admin-email') || '').toLowerCase().trim();
  return email === 'talhahally974@gmail.com';
}

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

    // 1) Courses metrics (approved/pending + sold total)
    const q = `
      query Overview($q: String!) {
        products(first: 250, query: $q) {
          edges {
            node {
              approval: metafield(namespace:"mfapp", key:"approval_status") { value }
              sales: metafield(namespace:"mfapp", key:"sales_count") { value }
            }
          }
        }
      }
    `;
    const r = await shopifyGraphql(q, { q: `tag:"mkt-course"` });
    if (!r.ok) {
      return jsonWithCors(req, { ok: false, error: `Shopify ${r.status}`, detail: r.text }, { status: r.status });
    }

    const edges = r.json?.data?.products?.edges || [];
    let coursesApproved = 0;
    let coursesPending = 0;
    let coursesSoldTotal = 0;

    edges.forEach((e: any) => {
      const n = e?.node || {};
      const st = String(n?.approval?.value || 'pending').trim().toLowerCase();
      if (st === 'approved') coursesApproved += 1;
      else coursesPending += 1;

      coursesSoldTotal += toIntSafe(n?.sales?.value);
    });

    // 2) Placeholder subs/mrr/payouts (tu brancheras Stripe après)
    const subs_active = 0;
    const subs_starter = 0;
    const subs_pro = 0;
    const subs_business = 0;

    const mrr_eur = 0;
    const sales_30d_eur = 0;
    const payouts_pending_count = 0;
    const payouts_pending_eur = 0;

    return jsonWithCors(req, {
      ok: true,

      // "formateurs" : si tu veux vraiment -> on le branchera à /trainers (customers taggés)
      trainers_total: 0,
      trainers_approved: 0,
      trainers_pending: 0,

      subscriptions_active: subs_active,
      subs_active,
      subs_starter,
      subs_pro,
      subs_business,

      mrr_eur,
      mrr_label: `${mrr_eur} €`,

      sales_30d: sales_30d_eur,
      sales_30d_label: `${sales_30d_eur} €`,

      payouts_pending_count,
      payouts_pending_eur,
      payouts_pending_label: `${payouts_pending_eur} €`,

      // ✅ NOUVEAU KPI
      courses_sold_total: coursesSoldTotal,

      // bonus si tu veux l’afficher plus tard
      courses_approved: coursesApproved,
      courses_pending: coursesPending,
    });
  } catch (e: any) {
    return jsonWithCors(req, { ok: false, error: e?.message || 'overview_failed' }, { status: 500 });
  }
}
