// app/api/courses/route.ts
// Crée un produit "Course" (vendor = email) + liste les courses.
// Vérifie l'abonnement (via /api/subscription interne) + applique le quota Starter (3 / mois).
// Champs produits : image de couverture + métachamps mf.owner_email / mf.owner_id / mf.pdf_url (pdf_url = type url).
// Ajoute à une collection par ID OU par handle (résolution → ID).
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
  try {
    json = text ? JSON.parse(text) : {}
  } catch {}
  return { ok: res.ok, status: res.status, json, text }
}

/** Upsert d'un métachamp produit avec typage explicite (évite 422). */
async function upsertProductMetafield(productId: number, namespace: string, key: string, type: string, value: string) {
  // REST create (pas en inline sur product)
  return shopifyFetch(`/metafields.json`, {
    json: {
      metafield: {
        namespace,
        key,
        type,                  // ex: 'url' | 'single_line_text_field'
        value,
        owner_resource: 'product',
        owner_id: productId,
      },
    },
  })
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

  // try custom collections
  const cc = await shopifyFetch(
    `/custom_collections.json?handle=${encodeURIComponent(handle)}&limit=1`
  )
  const ccId = cc.json?.custom_collections?.[0]?.id
  if (cc.ok && ccId) return Number(ccId)

  // try smart collections
  const sc = await shopifyFetch(
    `/smart_collections.json?handle=${encodeURIComponent(handle)}&limit=1`
  )
  const scId = sc.json?.smart_collections?.[0]?.id
  if (sc.ok && scId) return Number(scId)

  return null
}

/** Récupère le plan d'abonnement courant via l'API interne (fallback Starter). */
async function getPlanFromInternalSubscription(req: Request, email: string): Promise<'Starter' | 'Pro' | 'Business'> {
  try {
    const url = new URL(req.url)
    const base = `${url.protocol}//${url.host}` // même host que cette route
    const r = await fetch(`${base}/api/subscription`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // adapte si ton /api/subscription attend autre chose (customerId, session, etc.)
      body: JSON.stringify({ email }),
      cache: 'no-store',
    })
    const data = await r.json().catch(() => ({}))
    const plan: string = (data?.plan || data?.tier || 'Starter').toString()
    if (/business/i.test(plan)) return 'Business'
    if (/pro/i.test(plan)) return 'Pro'
    return 'Starter'
  } catch {
    return 'Starter'
  }
}

/** Compte les cours créés ce mois-ci pour un vendor (email). */
async function countThisMonthCoursesForVendor(email: string): Promise<number> {
  const vendor = encodeURIComponent(email || 'unknown@vendor')
  // Shopify REST ne filtre pas par mois, on filtre côté app
  const r = await shopifyFetch(`/products.json?vendor=${vendor}&limit=250`)
  if (!r.ok) return 0
  const products = r.json?.products || []
  const bucket = ym()
  return products.filter((p: any) => {
    const d = new Date(p.created_at)
    return ym(d) === bucket
  }).length
}

export async function OPTIONS(req: Request) {
  return handleOptions(req)
}

export async function GET(req: Request) {
  try {
    if (!process.env.SHOP_DOMAIN || !getAdminToken()) {
      return jsonWithCors(
        req,
        { ok: false, error: 'Missing SHOP_DOMAIN or Admin token' },
        { status: 500 }
      )
    }

    const url = new URL(req.url)
    const email = (url.searchParams.get('email') || '').trim()
    const vendor = email || 'unknown@vendor'

    // Liste de produits par vendor
    const r = await shopifyFetch(
      `/products.json?vendor=${encodeURIComponent(vendor)}&limit=50`
    )
    if (!r.ok) {
      return jsonWithCors(
        req,
        { ok: false, error: `Shopify ${r.status}`, detail: r.text },
        { status: r.status }
      )
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
    return jsonWithCors(
      req,
      { ok: false, error: e?.message || 'list_failed' },
      { status: 500 }
    )
  }
}

export async function POST(req: Request) {
  try {
    if (!process.env.SHOP_DOMAIN || !getAdminToken()) {
      return jsonWithCors(
        req,
        { ok: false, error: 'Missing SHOP_DOMAIN or Admin token' },
        { status: 500 }
      )
    }

    const body = await req.json().catch(() => ({}))
    const {
      email,
      shopifyCustomerId,
      title,
      description,
      imageUrl,
      pdfUrl: pdfUrlRaw,
      pdf_url, // alias accepté
      collectionHandle, // ancien param (handle)
      collectionId, // id direct
      collectionHandleOrId, // flexible (handle ou id)
    } = body || {}

    const pdfUrl = String(pdfUrlRaw || pdf_url || '').trim()

    if (!email || !title || !imageUrl || !pdfUrl) {
      return jsonWithCors(
        req,
        { ok: false, error: 'missing fields' },
        { status: 400 }
      )
    }
    if (!/^https?:\/\//i.test(pdfUrl)) {
      return jsonWithCors(
        req,
        { ok: false, error: 'pdfUrl must be a public https URL' },
        { status: 400 }
      )
    }

    // ====== Vérif quota via /api/subscription ======
    const plan = await getPlanFromInternalSubscription(req, email)
    if (plan === 'Starter') {
      const count = await countThisMonthCoursesForVendor(email)
      if (count >= 3) {
        return jsonWithCors(
          req,
          { ok: false, error: 'quota_reached', detail: 'Starter plan allows 3 courses per month' },
          { status: 403 }
        )
      }
    }

    // ====== Création produit SANS métachamps (évite 422 si définition côté Shopify diverge) ======
    const productPayload = {
      product: {
        title,
        body_html: description ? `<p>${description}</p>` : '',
        vendor: email, // ✅ vendor = email
        images: imageUrl ? [{ src: imageUrl }] : [],
        tags: ['mf-course'],
        status: 'active', // ou 'draft' si souhaité
      },
    }

    const createRes = await shopifyFetch(`/products.json`, { json: productPayload })
    if (!createRes.ok) {
      return jsonWithCors(
        req,
        { ok: false, error: `Shopify ${createRes.status}`, detail: createRes.text },
        { status: createRes.status }
      )
    }
    const created = createRes.json?.product
    if (!created?.id) {
      return jsonWithCors(req, { ok: false, error: 'create_failed_no_id' }, { status: 500 })
    }

    // ====== Upsert métachamps typés (namespace 'mf') ======
    const metafieldResults: Array<{ key: string; ok: boolean; status: number }> = []

    // owner_email
    {
      const r = await upsertProductMetafield(created.id, 'mf', 'owner_email', 'single_line_text_field', String(email))
      metafieldResults.push({ key: 'owner_email', ok: r.ok, status: r.status })
    }
    // owner_id (facultatif)
    if (shopifyCustomerId) {
      const r = await upsertProductMetafield(created.id, 'mf', 'owner_id', 'single_line_text_field', String(shopifyCustomerId))
      metafieldResults.push({ key: 'owner_id', ok: r.ok, status: r.status })
    }
    // pdf_url (TYPE URL ✅)
    {
      const r = await upsertProductMetafield(created.id, 'mf', 'pdf_url', 'url', pdfUrl)
      metafieldResults.push({ key: 'pdf_url', ok: r.ok, status: r.status })
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

    const warnings = metafieldResults.filter(m => !m.ok).map(m => m.key)
    return jsonWithCors(req, {
      ok: true,
      id: created.id,
      handle: created.handle,
      admin_url: `https://${process.env.SHOP_DOMAIN}/admin/products/${created.id}`,
      planEnforced: plan,
      attachedCollectionId,
      warnings: warnings.length ? warnings : undefined,
    })
  } catch (e: any) {
    return jsonWithCors(
      req,
      { ok: false, error: e?.message || 'create_failed' },
      { status: 500 }
    )
  }
}
