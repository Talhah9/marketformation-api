// lib/usage.ts
// Compteur de publications/mois sur le Customer Shopify
// namespace: mfapp ; key: published_YYYYMM ; type: number_integer

const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-07';

// 🔧 Harmonisation ENV
const STORE =
  process.env.SHOPIFY_STORE_DOMAIN || // ex: tqiccz-96.myshopify.com
  process.env.SHOP_DOMAIN;

const TOKEN =
  process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN || // clé Admin privée
  process.env.ADMIN_TOKEN;

if (!STORE || !TOKEN) {
  console.warn('[usage] Missing STORE/TOKEN envs', { hasStore: !!STORE, hasToken: !!TOKEN });
}

const BASE = `https://${STORE}/admin/api/${API_VERSION}`;

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': TOKEN!,
    'Accept': 'application/json',
  };
}

async function findMetafield(customerId: string | number, key: string) {
  const url = `${BASE}/customers/${customerId}/metafields.json?namespace=mfapp&key=${encodeURIComponent(key)}`;
  const r = await fetch(url, { headers: authHeaders(), cache: 'no-store' });
  if (!r.ok) throw new Error(`Shopify findMetafield ${r.status} ${await r.text()}`);
  const data = await r.json();
  return (data.metafields?.[0]) || null;
}

export async function getMonthlyCount(customerId: string | number, yyyymm: string): Promise<number> {
  const key = `published_${yyyymm}`;
  const mf = await findMetafield(customerId, key);
  if (!mf) return 0;
  const val = Number(mf.value);
  return Number.isFinite(val) ? val : 0;
}

export async function bumpMonthlyCount(customerId: string | number, yyyymm: string): Promise<number> {
  const key = `published_${yyyymm}`;
  const existing = await findMetafield(customerId, key);
  if (existing) {
    const newVal = String((Number(existing.value) || 0) + 1);
    const r = await fetch(`${BASE}/metafields/${existing.id}.json`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ metafield: { id: existing.id, value: newVal, type: 'number_integer' } }),
    });
    if (!r.ok) throw new Error(`Shopify bump PUT ${r.status} ${await r.text()}`);
    return Number(newVal);
  } else {
    const r = await fetch(`${BASE}/metafields.json`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        metafield: {
          namespace: 'mfapp',
          key,
          type: 'number_integer',
          value: '1',
          owner_resource: 'customer',
          owner_id: Number(customerId),
        },
      }),
    });
    if (!r.ok) throw new Error(`Shopify bump POST ${r.status} ${await r.text()}`);
    return 1;
  }
}
