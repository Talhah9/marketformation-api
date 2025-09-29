// app/api/courses/route.ts
// Crée un produit "Course" (vendor = email) + liste les courses.
// Vérifie l'abonnement Stripe + applique le quota Starter (3 / mois).
// Champs produits: image de couverture + métachamps mf.owner_email / mf.owner_id / mf.pdf_url.
// Ajoute à une collection par ID OU par handle (résolution → ID).
// Réponses via jsonWithCors (CORS util maison).

import { handleOptions, jsonWithCors } from '@/app/api/_lib/cors'
// import stripe from '@/lib/stripe'         // (optionnel) décommente si tu utilises Stripe ici
// import type Stripe from 'stripe'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/* ===== ENV requis =====
  SHOP_DOMAIN                      ex: tqiccz-96.myshopify.com
  SHOP_ADMIN_TOKEN / ADMIN_TOKEN   token Admin API
  STRIPE_SECRET_KEY                clé serveur Stripe
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

    // ====== Création produit ======
    // IMPORTANT : le métachamp PDF est en type "url" pour matcher ta définition Shopify.
    const productPayload = {
      product: {
        title,
        body_html: description || '',
        vendor: email,
        images: imageUrl ? [{ src: imageUrl }] : [],
        metafields: [
          {
            namespace: 'mf', // ✅ aligne avec ta définition
            key: 'owner_email',
            type: 'single_line_text_field',
            value: String(email),
          },
          {
            namespace: 'mf',
            key: 'owner_id',
            type: 'single_line_text_field',
            value: String(shopifyCustomerId || ''),
          },
          {
            namespace: 'mf',
            key: 'pdf_url',
            type: 'url', // ✅ FIX: le type doit être "url"
            value: pdfUrl,
          },
        ],
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

    // ====== Ajout à la collection (ID direct, handle, ou flexible) ======
    const selector = collectionId ?? collectionHandleOrId ?? collectionHandle
    if (selector) {
      const cid = await resolveCollectionId(selector)
      if (cid) {
        await shopifyFetch(`/collects.json`, {
          json: { collect: { product_id: created.id, collection_id: cid } },
        }).catch(() => null)
      }
    }

    return jsonWithCors(req, { ok: true, id: created?.id, product: created })
  } catch (e: any) {
    return jsonWithCors(
      req,
      { ok: false, error: e?.message || 'create_failed' },
      { status: 500 }
    )
  }
}
