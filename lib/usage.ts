// lib/usage.ts
// Compteur publications/mois sur Customer Shopify
// namespace: mfapp ; key: published_YYYYMM ; type: number_integer

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-07";

async function shopify(path: string, init?: RequestInit & { json?: any }) {
  const shop = process.env.SHOP_DOMAIN;
  const token =
    process.env.SHOP_ADMIN_TOKEN ||
    process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN ||
    process.env.ADMIN_TOKEN ||
    "";

  const url = `https://${shop}/admin/api/${API_VERSION}${path}`;
  const headers: Record<string, string> = {
    "X-Shopify-Access-Token": token,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  const res = await fetch(url, {
    method: init?.method || (init?.json ? "POST" : "GET"),
    headers,
    body: init?.json ? JSON.stringify(init.json) : undefined,
    cache: "no-store",
  });

  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {}
  return { ok: res.ok, status: res.status, json, text };
}

function keyFor(periodYYYYMM: string) {
  return `published_${periodYYYYMM}`;
}

export async function getMonthlyCount(customerId: string, periodYYYYMM: string) {
  const key = keyFor(periodYYYYMM);
  const mfGet = await shopify(
    `/customers/${customerId}/metafields.json?namespace=mfapp&key=${key}`
  );

  const mf = mfGet.json?.metafields?.[0];
  if (!mf?.value) return 0;

  const n = parseInt(String(mf.value), 10);
  return Number.isNaN(n) ? 0 : n;
}

export async function bumpMonthlyCount(customerId: string, periodYYYYMM: string) {
  const key = keyFor(periodYYYYMM);

  const mfGet = await shopify(
    `/customers/${customerId}/metafields.json?namespace=mfapp&key=${key}`
  );

  const mf = mfGet.json?.metafields?.[0];
  let current = 0;

  if (mf?.value) {
    const n = parseInt(String(mf.value), 10);
    if (!Number.isNaN(n)) current = n;
  }

  const next = current + 1;

  if (mf?.id) {
    await shopify(`/metafields/${mf.id}.json`, {
      method: "PUT",
      json: { metafield: { id: mf.id, value: String(next), type: "number_integer" } },
    });
  } else {
    await shopify(`/metafields.json`, {
      method: "POST",
      json: {
        metafield: {
          namespace: "mfapp",
          key,
          value: String(next),
          type: "number_integer",
          owner_resource: "customer",
          owner_id: customerId,
        },
      },
    });
  }

  return next;
}
