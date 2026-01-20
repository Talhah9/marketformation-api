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

function isAdminReq(req: Request) {
  const email = (req.headers.get('x-mf-admin-email') || '').toLowerCase().trim();
  const allow = (process.env.MF_ADMIN_EMAILS || 'talhahally974@gmail.com')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return !!email && allow.includes(email);
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
      return jsonWithCors(req, { ok: false, error: 'Missing SHOP_DOMAIN or admin token' }, { status: 500 });
    }
    if (!isAdminReq(req)) {
      return jsonWithCors(req, { ok: false, error: 'admin_forbidden' }, { status: 403 });
    }

    // ✅ MVP overview: calcule "trainers_total" + "courses_sold_total" depuis Shopify
    // Le reste = 0 / — (tu brancheras Stripe plus tard)
    const q = `
      query AdminOverview($qCourses: String!, $qTrainers: String!) {
        courses: products(first: 250, query: $qCourses) {
          edges {
            node {
              id
              approval: metafield(namespace:"mfapp", key:"approval_status") { value }
              sales: metafield(namespace:"mfapp", key:"sales_count") { value }
            }
          }
        }
        trainers: customers(first: 250, query: $qTrainers) {
          edges { node { id } }
        }
      }
    `;

    const coursesQuery = `tag:"mkt-course"`;
    const trainerTags = String(process.env.MF_TRAINER_TAGS || 'mf_trainer,mkt-trainer')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const trainersQuery =
      trainerTags.length === 1 ? `tag:${trainerTags[0]}` : trainerTags.map((t) => `tag:${t}`).join(' OR ');

    const r = await shopifyGraphql(q, { qCourses: coursesQuery, qTrainers: trainersQuery });
    if (!r.ok) {
      return jsonWithCors(req, { ok: false, error: `Shopify ${r.status}`, detail: r.text }, { status: r.status });
    }

    const coursesEdges = r.json?.data?.courses?.edges || [];
    const trainersEdges = r.json?.data?.trainers?.edges || [];

    let coursesSoldTotal = 0;
    let coursesApproved = 0;
    let coursesPending = 0;

    coursesEdges.forEach((e: any) => {
      const n = toIntSafe(e?.node?.sales?.value);
      coursesSoldTotal += n;

      const st = String(e?.node?.approval?.value || 'pending').toLowerCase().trim();
      if (st === 'approved') coursesApproved += 1;
      else coursesPending += 1;
    });

    const trainersTotal = trainersEdges.length;

    return jsonWithCors(req, {
      ok: true,

      // trainers
      trainers_total: trainersTotal,
      trainers_approved: '—', // pas de champ d'approbation trainers en MVP
      trainers_pending: '—',

      // subs/mrr (placeholder MVP)
      subs_active: '—',
      subs_starter: '—',
      subs_pro: '—',
      subs_business: '—',
      mrr: '—',
      sales_30d: '—',

      // payouts (placeholder MVP)
      payouts_pending_count: '—',
      payouts_pending_eur: null,
      payouts_pending_label: '—',

      // ✅ nouveau
      courses_sold_total: coursesSoldTotal,
      courses_approved: coursesApproved,
      courses_pending: coursesPending,
    });
  } catch (e: any) {
    return jsonWithCors(req, { ok: false, error: e?.message || 'admin_overview_failed' }, { status: 500 });
  }
}
