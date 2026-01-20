// app/api/admin/payouts/route.ts
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

function isAdminReq(req: Request) {
  const email = (req.headers.get('x-mf-admin-email') || '').toLowerCase().trim();
  const allow = (process.env.MF_ADMIN_EMAILS || 'talhahally974@gmail.com')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return !!email && allow.includes(email);
}

function safeText(v: any) {
  return String(v ?? '').replace(/\s+/g, ' ').trim();
}

function toNumberSafe(v: any) {
  const n = Number(String(v ?? '').replace(',', '.').trim());
  return Number.isFinite(n) ? n : 0;
}

function formatDateLabel(iso: string) {
  const s = safeText(iso);
  if (!s) return '—';
  // Format simple: YYYY-MM-DD -> DD/MM/YYYY
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s;
}

/**
 * ✅ MVP payouts:
 * - On lit des "metaobjects" Shopify (si tu en as) ex: type "mf_payout"
 * - Sinon -> liste vide (ok:true)
 *
 * Configure au besoin:
 * - MF_PAYOUT_METAOBJECT_TYPE (default: mf_payout)
 * - Champs attendus dans le metaobject:
 *   trainer_name, trainer_email, amount_eur, status, created_at
 */
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

    const type = safeText(process.env.MF_PAYOUT_METAOBJECT_TYPE || 'mf_payout');

    const q = `
      query AdminPayouts($type: String!) {
        metaobjects(type: $type, first: 250) {
          edges {
            node {
              id
              handle
              createdAt
              fields {
                key
                value
              }
            }
          }
        }
      }
    `;

    const r = await shopifyGraphql(q, { type });

    // Si le type n'existe pas, Shopify renvoie souvent des erreurs -> on fallback vide sans casser l'admin.
    const hasErrors = Array.isArray(r.json?.errors) && r.json.errors.length;
    if (!r.ok || hasErrors) {
      return jsonWithCors(req, { ok: true, items: [] });
    }

    const edges = r.json?.data?.metaobjects?.edges || [];

    const items = edges.map((e: any) => {
      const node = e?.node || {};
      const fieldsArr = Array.isArray(node.fields) ? node.fields : [];
      const fields: Record<string, string> = {};
      fieldsArr.forEach((f: any) => {
        const k = safeText(f?.key);
        if (!k) return;
        fields[k] = safeText(f?.value);
      });

      const trainer_name = safeText(fields.trainer_name || fields.trainer || '—');
      const amount_eur = toNumberSafe(fields.amount_eur || fields.amount || 0);
      const status = safeText(fields.status || 'pending');
      const createdAt = safeText(fields.created_at || node.createdAt || '');
      const date_label = formatDateLabel(createdAt);

      const status_label =
        status === 'paid' || status === 'done' ? 'Payé' :
        status === 'rejected' ? 'Refusé' :
        status === 'processing' ? 'En cours' :
        'En attente';

      return {
        trainer_name,
        amount_eur,
        amount_label: `${amount_eur} €`,
        status,
        status_label,
        date: createdAt || '—',
        date_label,
      };
    });

    // Option: trier par date desc
    items.sort((a: any, b: any) => String(b.date || '').localeCompare(String(a.date || '')));

    return jsonWithCors(req, { ok: true, items });
  } catch (e: any) {
    return jsonWithCors(req, { ok: false, error: e?.message || 'admin_payouts_failed' }, { status: 500 });
  }
}
