// lib/usage.ts
// Compteur de publications/mois sur le Customer Shopify
// namespace: mfapp ; key: published_YYYYMM ; type: number_integer

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-07";

async function shopify(path: string, init?: RequestInit & { json?: any }) {
  const shop = process.env.SHOP_DOMAIN;
  const token =
    process.env.SHOP_ADMIN_TOKEN ||
    process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN ||
    process.env.ADMIN_TOKEN ||
    "";

  if (!shop) {
    return { ok: false, status: 500, json: { error: "Missing SHOP_DOMAIN" }, text: "" };
  }
  if (!token) {
    return { ok: false, status: 500, json: { error: "Missing SHOP_ADMIN_TOKEN/ADMIN_TOKEN" }, text: "" };
  }

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

function keyFor(period: string) {
  const p = String(period || "").trim();
  if (!/^\d{6}$/.test(p)) throw new Error("invalid_period_yyyymm");
  return `published_${p}`;
}

/**
 * Lit le compteur mensuel (YYYYMM) depuis le metafield customer.
 */
export async function getMonthlyCount(customerId: string, period: string): Promise<number> {
  const key = keyFor(period);

  const mfGet = await shopify(
    `/customers/${customerId}/metafields.json?namespace=mfapp&key=${encodeURIComponent(key)}`
  );

  if (!mfGet.ok) return 0;

  const mf = mfGet.json?.metafields?.[0];
  if (!mf) return 0;

  const n = parseInt(String(mf.value ?? "0"), 10);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * Incrémente le compteur mensuel (YYYYMM) et renvoie la valeur mise à jour.
 */
export async function bumpMonthlyCount(customerId: string, period: string): Promise<number> {
  const key = keyFor(period);

  // read metafield
  const mfGet = await shopify(
    `/customers/${customerId}/metafields.json?namespace=mfapp&key=${encodeURIComponent(key)}`
  );

  let current = 0;
  const mf = mfGet.json?.metafields?.[0];

  if (mf && mf.value != null) {
    const n = parseInt(String(mf.value), 10);
    if (!Number.isNaN(n)) current = n;
  }

  const next = current + 1;

  if (mf?.id) {
    // update
    await shopify(`/metafields/${mf.id}.json`, {
      method: "PUT",
      json: {
        metafield: {
          id: mf.id,
          value: String(next),
          type: "number_integer",
        },
      },
    });
  } else {
    // create
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

/**
 * Compat: si du code ailleurs appelle encore incPublishedCount(customerId, yyyymm)
 * on garde un alias pour éviter de casser.
 */
export async function incPublishedCount(customerId: string, yyyymm: string) {
  return bumpMonthlyCount(customerId, yyyymm);
}
