// app/api/admin/courses/approve/route.ts
import { handleOptions, jsonWithCors } from '@/app/api/_lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function ym(d = new Date()) {
  return String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, '0');
}

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
  try {
    json = text ? JSON.parse(text) : {};
  } catch {}
  return { ok: res.ok, status: res.status, json, text };
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

async function upsertProductMetafield(
  productId: number,
  namespace: string,
  key: string,
  type: string,
  value: string
) {
  return shopifyFetch(`/metafields.json`, {
    json: {
      metafield: {
        namespace,
        key,
        type,
        value,
        owner_resource: 'product',
        owner_id: productId,
      },
    },
  });
}

function isAdminReq(req: Request) {
  const email = (req.headers.get('x-mf-admin-email') || '').toLowerCase().trim();
  const allow = (process.env.MF_ADMIN_EMAILS || 'talhahally974@gmail.com')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return !!email && allow.includes(email);
}

/** accepte "123" OU "gid://shopify/Product/123" */
function extractNumericProductId(input: string) {
  const s = String(input || '').trim();
  if (!s) return '';
  if (/^\d+$/.test(s)) return s;
  const m = s.match(/\/Product\/(\d+)$/);
  return m ? m[1] : '';
}

/** Trouve l'ID de publication "Online Store" (ou fallback sur la 1ère) */
async function resolveOnlineStorePublicationId(): Promise<string> {
  // optionnel: mets-le en env pour éviter la query à chaque fois
  if (process.env.SHOP_PUBLICATION_ID) return process.env.SHOP_PUBLICATION_ID;

  const q = `
    query {
      publications(first: 20) {
        edges {
          node { id name }
        }
      }
    }
  `;
  const r = await shopifyGraphql(q);
  const edges = r.json?.data?.publications?.edges || [];
  const online = edges.find((e: any) =>
    String(e?.node?.name || '').toLowerCase().includes('online store')
  );
  return String((online || edges[0])?.node?.id || '').trim();
}

async function publishToOnlineStore(productGid: string) {
  const publicationId = await resolveOnlineStorePublicationId();
  if (!publicationId) return { ok: false, error: 'missing_publication_id' };

  const m = `
    mutation Publish($id: ID!, $pub: ID!) {
      publishablePublish(id: $id, input: { publicationId: $pub }) {
        userErrors { field message }
      }
    }
  `;
  const r = await shopifyGraphql(m, { id: productGid, pub: publicationId });
  const errs = r.json?.data?.publishablePublish?.userErrors || [];
  if (errs.length) {
    return {
      ok: false,
      error: errs[0]?.message || 'publish_failed',
      detail: errs,
    };
  }
  return { ok: true };
}

/* ===================== Collection resolve + add (pour Explorer) ===================== */
async function resolveCollectionId(handleOrId?: string | number): Promise<number | null> {
  if (!handleOrId) return null;

  const s = String(handleOrId).trim();
  if (!s) return null;

  // ID numérique direct
  if (/^\d+$/.test(s)) return Number(s);

  // custom collections
  let r = await shopifyFetch(
    `/custom_collections.json?handle=${encodeURIComponent(s)}&limit=1`
  );
  if (r.ok && (r.json as any)?.custom_collections?.[0]?.id) {
    return Number((r.json as any).custom_collections[0].id);
  }

  // smart collections
  r = await shopifyFetch(`/smart_collections.json?handle=${encodeURIComponent(s)}&limit=1`);
  if (r.ok && (r.json as any)?.smart_collections?.[0]?.id) {
    return Number((r.json as any).smart_collections[0].id);
  }

  return null;
}

async function addToCollection(productId: number, collectionHandleOrId: string) {
  const cid = await resolveCollectionId(collectionHandleOrId);
  if (!cid) return { ok: false, error: 'collection_not_found' };

  const r = await shopifyFetch(`/collects.json`, {
    json: { collect: { product_id: productId, collection_id: cid } },
  });

  // Si déjà dedans, Shopify peut renvoyer 422 -> on ignore
  if (!r.ok && r.status !== 422) return { ok: false, error: `collect_${r.status}`, detail: r.text };
  return { ok: true };
}

/* ===================== Routes ===================== */
export async function OPTIONS(req: Request) {
  return handleOptions(req);
}

export async function POST(req: Request) {
  try {
    if (!getShopDomain() || !getAdminToken()) {
      return jsonWithCors(
        req,
        { ok: false, error: 'Missing SHOP_DOMAIN or admin token' },
        { status: 500 }
      );
    }
    if (!isAdminReq(req)) {
      return jsonWithCors(req, { ok: false, error: 'admin_forbidden' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({} as any));
    const productIdRaw = String(body?.productId || '').trim();
    const productIdDigits = extractNumericProductId(productIdRaw);

    if (!productIdDigits) {
      return jsonWithCors(req, { ok: false, error: 'productId_required' }, { status: 400 });
    }

    const pid = Number(productIdDigits);
    const productGid = `gid://shopify/Product/${productIdDigits}`;

    // 1) Metafield approval_status = approved
    await upsertProductMetafield(pid, 'mfapp', 'approval_status', 'single_line_text_field', 'approved');

    // ✅ 1bis) Initialise sales_count si absent (ne casse rien)
    // NOTE: Shopify REST "metafields.json" va créer un nouveau metafield à chaque appel si key/namespace existent déjà ?
    // En pratique, sur product metafields REST, ça crée/écrase selon ID metafield.
    // Pour rester safe: on le "set" à 0 uniquement si env MF_INIT_SALES_ON_APPROVE=1
    if (String(process.env.MF_INIT_SALES_ON_APPROVE || '').trim() === '1') {
      await upsertProductMetafield(pid, 'mfapp', 'sales_count', 'number_integer', '0');
    }

    // 2) Active + published_at (couvre REST)
    const nowIso = new Date().toISOString();
    const r = await shopifyFetch(`/products/${pid}.json`, {
      method: 'PUT',
      json: { product: { id: pid, status: 'active', published_at: nowIso } },
    });
    if (!r.ok) {
      return jsonWithCors(
        req,
        { ok: false, error: `Shopify ${r.status}`, detail: r.text },
        { status: r.status }
      );
    }

    // 3) Publish sur Online Store (couvre le vrai besoin visibilité)
    const pub = await publishToOnlineStore(productGid);
    if (!pub.ok) {
      // on ne bloque pas si Shopify a déjà publié, mais on remonte l'info
      console.warn('[MF] publish warning', pub);
    }

    // ✅ 3bis) Ajout à la collection Explorer (pour que ça apparaisse dans ta section Shopify)
    const targetCollection = String(process.env.MF_EXPLORER_COLLECTION_HANDLE || '').trim();
    if (targetCollection) {
      const add = await addToCollection(pid, targetCollection);
      if (!add.ok) {
        // on ne bloque pas (sinon tu risques de "casser" l'approbation)
        console.warn('[MF] addToCollection warning', add);
      }
    }

    // 4) Bucket quota au moment de la vraie publication
    const bucket = ym();
    await upsertProductMetafield(pid, 'mfapp', 'published_YYYYMM', 'single_line_text_field', bucket);

    return jsonWithCors(req, {
      ok: true,
      productId: productIdDigits,
      published: true,
      added_to_collection: !!targetCollection,
    });
  } catch (e: any) {
    return jsonWithCors(req, { ok: false, error: e?.message || 'approve_failed' }, { status: 500 });
  }
}
