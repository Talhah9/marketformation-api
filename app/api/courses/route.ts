// app/api/courses/route.ts
// Crée un produit "Course" (vendor = email) + liste les courses.
// Quota Starter (3 / mois) basé sur le métachamp mfapp.published_YYYYMM.
// Métachamps: mkt.owner_email / mkt.owner_id / mkt.pdf_url (url).
// Ajout à une collection par ID OU par handle (résolution → ID).
// Réponses via jsonWithCors (CORS util maison).

import { handleOptions, jsonWithCors } from '@/app/api/_lib/cors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/* ===== ENV requis =====
  SHOP_DOMAIN                      ex: tqiccz-96.myshopify.com
  SHOP_ADMIN_TOKEN / ADMIN_TOKEN   token Admin API
*/

function ym(d = new Date()) {
  return String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, '0')
}

function getAdminToken() {
  return (
    process.env.SHOP_ADMIN_TOKEN ||
    process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN ||
    process.env.ADMIN_TOKEN ||
    ''
  )
}

async function shopifyFetch(
  path: string,
  init?: RequestInit & { json?: any }
) {
  const domain = process.env.SHOP_DOMAIN
  if (!domain) throw new Error('Missing env SHOP_DOMAIN')

  const base = `https://${domain}/admin/api/2024-07`
  const headers: Record<string, string> = {
    'X-Shopify-Access-Token': getAdminToken(),
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }

  const res = await fetch(base + path, {
    method: init?.method || (init?.json ? 'POST' : 'GET'),
    headers,
    body: init?.json ? JSON.stringify(init.json) : undefined,
    cache: 'no-store',
  })

  const text = await res.text()
  let json: any = {}
  try { json = text ? JSON.parse(text) : {} } catch {}
  return { ok: res.ok, status: res.status, json, text }
}

/** Upsert d'un métachamp produit (REST) avec typage explicite (évite 422). */
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
        type, // ex: 'url' | 'single_line_text_field'
        value,
        owner_resource: 'product',
        owner_id: productId,
      },
    },
  })
}

/** Lit un métachamp produit (renvoie string | null). */
async function getProductMetafieldValue(
  productId: number,
  namespace: string,
  key: string
): Promise<string | null> {
  const r = await shopifyFetch(`/products/${productId}/metafields.json?limit=250`)
  if (!r.ok) return null
  const arr: any[] = r.json?.metafields || []
  const mf = arr.find(m => m?.namespace === namespace && m?.key === key)
  return mf?.value ?? null
}

/** Résout un collection_id à partir d'un handle si nécessaire. */
async function resolveCollectionId(
  collectionHandleOrId?: string | number
): Promise<number | null> {
  if (!collectionHandleOrId) return null

  // Déjà un ID numérique ?
  const asNumber = Number(collectionHandleOrId)
  if (!Number.isNaN(asNumber) && String(asNumber) === String(collectionHandleOrId)) {
    return asNumber
  }

  // Sinon, on tente par handle (custom puis smart)
  const handle = String(collectionHandleOrId).trim()

  // custom collections
  const cc = await shopifyFetch(
    `/custom_collections.json?handle=${encodeURIComponent(handle)}&limit=1`
  )
  const ccId = cc.json?.custom_collections?.[0]?.id
  if (cc.ok && ccId) return Number(ccId)

  // smart collections
  const sc = await shopifyFetch(
    `/smart_collections.json?handle=${encodeURIComponent(handle)}&limit=1`
  )
  const scId = sc.json?.smart_collections?.[0]?.id
  if (sc.ok && scId) return Number(scId)

  return null
}

/** Récupère le plan via l'API interne. Unknown si non déterminé. */
async function getPlanFromInternalSubscription(
  req: Request,
  email: string
): Promise<'Starter'|'Pro'|'Business'|'Unknown'> {
  try {
    const url = new URL(req.url)
    const base = `${url.protocol}//${url.host}`
    const r = await fetch(`${base}/api/subscription`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
      cache: 'no-store',
    })
    const data = await r.json().catch(() => ({}))
    const raw = (data?.planKey || data?.plan || data?.tier || '').toString()
    if (/business/i.test(raw)) return 'Business'
    if (/pro/i.test(raw)) return 'Pro'
    if (/starter/i.test(raw)) return 'Starter'
    return 'Unknown'
  } catch {
    return 'Unknown'
  }
}

/** Compte les cours publiés ce mois-ci via mfapp.published_YYYYMM. */
async function countPublishedThisMonthByMetafield(email: string): Promise<number> {
  const vendor = encodeURIComponent(email || 'unknown@vendor')
  const r = await shopifyFetch(`/products.json?vendor=${vendor}&limit=250`)
  if (!r.ok) return 0
  const products: any[] = r.json?.products || []
  const bucket = ym()

  // Concurrence limitée pour éviter le rate limit
  const limit = 5
  let i = 0
  let count = 0
  while (i < products.length) {
    const slice = products.slice(i, i + limit)
    const vals = await Promise.all(
      slice.map(p => getProductMetafieldValue(p.id, 'mfapp', 'published_YYYYMM'))
    )
    count += vals.filter(v => v === bucket).length
    i += limit
  }
  return count
}

export async function OPTIONS(req: Request) {
  return handleOptions(req)
}

export async function GET(req: Request) {
  try {
    if (!process.env.SHOP_DOMAIN || !getAdminToken()) {
      return jsonWithCors(req, { ok: false, error: 'Missing SHOP_DOMAIN or Admin token' }, { status: 500 })
    }

    const url = new URL(req.url)
    const email = (url.searchParams.get('email') || '').trim()
    const vendor = email || 'unknown@vendor'

    // Liste de produits par vendor
    const r = await shopifyFetch(`/products.json?vendor=${encodeURIComponent(vendor)}&limit=50`)
    if (!r.ok) {
      return jsonWithCors(req, { ok: false, error: `Shopify ${r.status}`, detail: r.text }, { status: r.status })
    }

    const products = r.json?.products || []
    const items = products.map((p: any) => ({
      id: p.id,
      title: p.title,
      coverUrl: p.image?.src || '',
      published: !!p.published_at,
      createdAt: p.created_at,
      image_url: p.image?.src || '',
    }))

    return jsonWithCors(req, { ok: true, items })
  } catch (e: any) {
    return jsonWithCors(req, { ok: false, error: e?.message || 'list_failed' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    if (!process.env.SHOP_DOMAIN || !getAdminToken()) {
      return jsonWithCors(req, { ok: false, error: 'Missing SHOP_DOMAIN or Admin token' }, { status: 500 })
    }

    const url = new URL(req.url)
    const bypassQuota = url.searchParams.get('bypassQuota') === '1' || url.searchParams.get('force') === '1'

    const body = await req.json().catch(() => ({}))
    const {
      email,
      shopifyCustomerId,
      title,
      description,
      imageUrl,
      pdfUrl: pdfUrlRaw,
      pdf_url,                 // alias accepté
      collectionHandle,        // ancien param (handle)
      collectionId,            // id direct
      collectionHandleOrId,    // flexible (handle ou id)
      status = 'active',       // 'active' = publié ; 'draft' = brouillon
    } = body || {}

    const pdfUrl = String(pdfUrlRaw || pdf_url || '').trim()

    if (!email || !title || !imageUrl || !pdfUrl) {
      return jsonWithCors(req, { ok: false, error: 'missing fields' }, { status: 400 })
    }
    if (!/^https?:\/\//i.test(pdfUrl)) {
      return jsonWithCors(req, { ok: false, error: 'pdfUrl must be a public https URL' }, { status: 400 })
    }

    // ====== Vérif quota : UNIQUEMENT si Starter confirmé ======
    const plan = await getPlanFromInternalSubscription(req, email)
    if (!bypassQuota && plan === 'Starter') {
      const count = await countPublishedThisMonthByMetafield(email)
      if (count >= 3) {
        return jsonWithCors(
          req,
          { ok: false, error: 'quota_reached', detail: 'Starter plan allows 3 published courses per month' },
          { status: 403 }
        )
      }
    }

    // ====== Création produit SANS métachamps (évite 422) ======
    const productPayload = {
      product: {
        title,
        body_html: description ? `<p>${description}</p>` : '',
        vendor: email, // ✅ vendor = email
        images: imageUrl ? [{ src: imageUrl }] : [],
        tags: ['mkt-course'],
        status, // 'active' ou 'draft'
      },
    }

    const createRes = await shopifyFetch(`/products.json`, { json: productPayload })
    if (!createRes.ok) {
      return jsonWithCors(req, { ok: false, error: `Shopify ${createRes.status}`, detail: createRes.text }, { status: createRes.status })
    }
    const created = createRes.json?.product
    if (!created?.id) {
      return jsonWithCors(req, { ok: false, error: 'create_failed_no_id' }, { status: 500 })
    }

    // ====== Upsert métachamps 'mkt' ======
    const mfResults: Array<{ key: string; ok: boolean; status: number }> = []

    {
      const r = await upsertProductMetafield(created.id, 'mkt', 'owner_email', 'single_line_text_field', String(email))
      mfResults.push({ key: 'owner_email', ok: r.ok, status: r.status })
    }
    if (shopifyCustomerId) {
      const r = await upsertProductMetafield(created.id, 'mkt', 'owner_id', 'single_line_text_field', String(shopifyCustomerId))
      mfResults.push({ key: 'owner_id', ok: r.ok, status: r.status })
    }
    {
      const r = await upsertProductMetafield(created.id, 'mkt', 'pdf_url', 'url', pdfUrl)
      mfResults.push({ key: 'pdf_url', ok: r.ok, status: r.status })
    }

    // ====== Si publié, marquer mfapp.published_YYYYMM ======
    let publishedMarkOk = false
    if (status === 'active') {
      const bucket = ym()
      const m = await upsertProductMetafield(created.id, 'mfapp', 'published_YYYYMM', 'single_line_text_field', bucket)
      publishedMarkOk = m.ok
    }

    // ====== Ajout à la collection (ID direct, handle, ou flexible) ======
    const selector = collectionId ?? collectionHandleOrId ?? collectionHandle
    let attachedCollectionId: number | null = null
    if (selector) {
      const cid = await resolveCollectionId(selector)
      if (cid) {
        attachedCollectionId = cid
        await shopifyFetch(`/collects.json`, {
          json: { collect: { product_id: created.id, collection_id: cid } },
        }).catch(() => null)
      }
    }

    const warnings = [
      ...mfResults.filter(m => !m.ok).map(m => `mkt.${m.key}`),
      ...(status === 'active' && !publishedMarkOk ? ['mfapp.published_YYYYMM'] : []),
    ]

    return jsonWithCors(req, {
      ok: true,
      id: created.id,
      handle: created.handle,
      admin_url: `https://${process.env.SHOP_DOMAIN}/admin/products/${created.id}`,
      planEnforced: bypassQuota ? `${plan} (bypass)` : plan,
      attachedCollectionId,
      publishedFlagSet: status === 'active' ? publishedMarkOk : false,
      warnings: warnings.length ? warnings : undefined,
    })
  } catch (e: any) {
    return jsonWithCors(req, { ok: false, error: e?.message || 'create_failed' }, { status: 500 })
  }
}
