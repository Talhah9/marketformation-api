
// app/api/courses/[id]/route.ts
// Suppression d'une formation (produit Shopify) par ID.
//
// DELETE  /api/courses/:id   → supprime le produit
// OPTIONS /api/courses/:id   → préflight CORS

import { handleOptions, jsonWithCors } from '@/app/api/_lib/cors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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

// Préflight CORS
export async function OPTIONS(req: Request) {
  return handleOptions(req)
}

// DELETE /api/courses/:id
export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    if (!process.env.SHOP_DOMAIN || !getAdminToken()) {
      return jsonWithCors(
        req,
        { ok: false, error: 'Missing SHOP_DOMAIN or Admin token' },
        { status: 500 }
      )
    }

    const id = params.id
    if (!id) {
      return jsonWithCors(
        req,
        { ok: false, error: 'missing_id' },
        { status: 400 }
      )
    }

    // Shopify DELETE produit
    const r = await shopifyFetch(`/products/${id}.json`, {
      method: 'DELETE',
    })

    if (!r.ok) {
      return jsonWithCors(
        req,
        { ok: false, error: `Shopify ${r.status}`, detail: r.text },
        { status: r.status }
      )
    }

    return jsonWithCors(req, { ok: true, id }, { status: 200 })
  } catch (e: any) {
    return jsonWithCors(
      req,
      { ok: false, error: e?.message || 'delete_failed' },
      { status: 500 }
    )
  }
}
