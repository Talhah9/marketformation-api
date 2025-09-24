// lib/usage.ts
// Compteur de publications/mois sur le Customer Shopify
// namespace: mfapp ; key: published_YYYYMM ; type: number_integer

const API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-07';

async function shopify(path: string, init?: RequestInit & { json?: any }) {
  const shop = process.env.SHOP_DOMAIN;
  const token = process.env.SHOP_ADMIN_TOKEN || process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN || process.env.ADMIN_TOKEN || '';
  const url = `https://${shop}/admin/api/${API_VERSION}${path}`;
  const headers: Record<string,string> = {
    'X-Shopify-Access-Token': token,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
  const res = await fetch(url, {
    method: init?.method || (init?.json ? 'POST' : 'GET'),
    headers,
    body: init?.json ? JSON.stringify(init.json) : undefined,
    cache: 'no-store'
  });
  const text = await res.text();
  let json: any = {};
  try { json = text ? JSON.parse(text) : {}; } catch {}
  return { ok: res.ok, status: res.status, json, text };
}

export async function incPublishedCount(customerId: string, yyyymm: string) {
  const key = `published_${yyyymm}`;
  // read metafield
  const mfGet = await shopify(`/customers/${customerId}/metafields.json?namespace=mfapp&key=${key}`);
  let current = 0;
  const mf = mfGet.json?.metafields?.[0];
  if (mf && mf.value) {
    const n = parseInt(String(mf.value), 10);
    if (!Number.isNaN(n)) current = n;
  }
  const next = current + 1;

  if (mf) {
    await shopify(`/metafields/${mf.id}.json`, { method: 'PUT', json: { metafield: { id: mf.id, value: String(next), type: 'number_integer' } } });
  } else {
    await shopify(`/metafields.json`, { method: 'POST', json: { metafield: {
      namespace: 'mfapp', key, value: String(next), type: 'number_integer', owner_resource: 'customer', owner_id: customerId
    } } });
  }

  return next;
}
