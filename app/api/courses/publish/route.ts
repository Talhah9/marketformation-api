// app/api/courses/publish/route.ts
// Bascule la publication d'un cours via le métachamp mfapp.published_YYYYMM
// Optionnel: met aussi le produit en 'active'/'draft' si alsoUpdateStatus = true
//
// POST JSON:
// {
//   "productId": 1234567890,
//   "published": true,              // true => publish, false => unpublish
//   "alsoUpdateStatus": true        // optionnel (défaut: false)
// }
//
// Réponse: { ok:true, productId, action:'published'|'unpublished', mfSet:boolean, statusUpdated?:boolean }

import { handleOptions, jsonWithCors } from '@/app/api/_lib/cors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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

async function listProductMetafields(productId: number) {
  return shopifyFetch(`/products/${productId}/metafields.json?limit=250`)
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
  })
}

async function deleteMetafield(metafieldId: number) {
  return shopifyFetch(`/metafields/${metafieldId}.json`, { method: 'DELETE' })
}

async function updateProductStatus(productId: number, status: 'active' | 'draft') {
  return shopifyFetch(`/products/${productId}.json`, {
    method: 'PUT',
    json: { product: { id: productId, status } },
  })
}

export async function OPTIONS(req: Request) {
  return handleOptions(req)
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
    const productId = Number(body?.productId)
    const published = Boolean(body?.published)
    const alsoUpdateStatus = Boolean(body?.alsoUpdateStatus)

    if (!productId || Number.isNaN(productId)) {
      return jsonWithCors(req, { ok: false, error: 'missing productId' }, { status: 400 })
    }

    // Cherche le MF existant
    const mfList = await listProductMetafields(productId)
    if (!mfList.ok) {
      return jsonWithCors(
        req,
        { ok: false, error: `Shopify ${mfList.status}`, detail: mfList.text },
        { status: mfList.status }
      )
    }
    const arr: any[] = mfList.json?.metafields || []
    const existing = arr.find(m => m?.namespace === 'mfapp' && m?.key === 'published_YYYYMM')

    let mfSet = false
    let statusUpdated = false

    if (published) {
      // Pose/écrase le MF avec YYYYMM courant
      const r = await upsertProductMetafield(productId, 'mfapp', 'published_YYYYMM', 'single_line_text_field', ym())
      mfSet = r.ok
      if (!r.ok) {
        return jsonWithCors(
          req,
          { ok: false, error: `metafield_upsert_failed`, detail: r.text },
          { status: 500 }
        )
      }
      if (alsoUpdateStatus) {
        const u = await updateProductStatus(productId, 'active')
        statusUpdated = u.ok
      }
    } else {
      // Supprime le MF si présent
      if (existing?.id) {
        const d = await deleteMetafield(Number(existing.id))
        if (!d.ok && d.status !== 404) {
          return jsonWithCors(
            req,
            { ok: false, error: `metafield_delete_failed`, detail: d.text },
            { status: 500 }
          )
        }
      }
      mfSet = false
      if (alsoUpdateStatus) {
        const u = await updateProductStatus(productId, 'draft')
        statusUpdated = u.ok
      }
    }

    return jsonWithCors(req, {
      ok: true,
      productId,
      action: published ? 'published' : 'unpublished',
      mfSet,
      ...(alsoUpdateStatus ? { statusUpdated } : {}),
    })
  } catch (e: any) {
    return jsonWithCors(req, { ok: false, error: e?.message || 'publish_failed' }, { status: 500 })
  }
}
