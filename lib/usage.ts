// lib/usage.ts
// Stocke le compteur de publications par mois sur le Customer Shopify :
// namespace: mfapp ; key: published_YYYYMM ; type: number_integer

const API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-07';
const BASE = `https://${process.env.SHOP_DOMAIN}/admin/api/${API_VERSION}`;

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': process.env.ADMIN_TOKEN!,
  };
}

async function findMetafield(customerId: string | number, key: string) {
  const url = `${BASE}/customers/${customerId}/metafields.json?namespace=mfapp&key=${encodeURIComponent(key)}`;
  const r = await fetch(url, { headers: authHeaders(), cache: 'no-store' });
  if (!r.ok) throw new Error(`Shopify findMetafield ${r.status}`);
  const data = await r.json();
  return (data.metafields?.[0]) || null;
}

export async function getMonthlyCount(customerId: string | number, yyyymm: string): Promise<number | null> {
  const key = `published_${yyyymm}`;
  const mf = await findMetafield(customerId, key);
  if (!mf) return 0;
  const val = Number(mf.value);
  return Number.isFinite(val) ? val : 0;
}

export async function bumpMonthlyCount(customerId: string | number, yyyymm: string): Promise<number> {
  const key = `published_${yyyymm}`;
  const mf = await findMetafield(customerId, key);
  if (mf) {
    const newVal = String(Number(mf.value) + 1);
    const r = await fetch(`${BASE}/metafields/${mf.id}.json`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ metafield: { id: mf.id, value: newVal, type: 'number_integer' } }),
    });
    if (!r.ok) throw new Error(`Shopify bump PUT ${r.status}`);
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
    if (!r.ok) throw new Error(`Shopify bump POST ${r.status}`);
    return 1;
  }
}
