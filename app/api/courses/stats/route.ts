// app/api/courses/stats/route.ts
// Statistiques par formateur (vendor = email)
// - Ventes totales par formation
// - Ventes sur 7 jours
// - (optionnel) vues via métachamps mkt.views_total / mkt.views_7d
// - Top formations + totals globaux

import { jsonWithCors, handleOptions } from '@/app/api/_lib/cors'

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
  if (!domain) throw new Error('Missing SHOP_DOMAIN')

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

/** Lit un métachamp produit (renvoie string | null). */
async function getProductMetafieldValue(
  productId: number,
  namespace: string,
  key: string
): Promise<string | null> {
  const r = await shopifyFetch(
    `/products/${productId}/metafields.json?limit=250`
  )
  if (!r.ok) return null
  const arr: any[] = r.json?.metafields || []
  const mf = arr.find(m => m?.namespace === namespace && m?.key === key)
  return mf?.value ?? null
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
    if (!email) {
      return jsonWithCors(
        req,
        { ok: false, error: 'missing_email' },
        { status: 400 }
      )
    }

    // 1) Récupérer les produits du formateur (vendor = email)
    const rProducts = await shopifyFetch(
      `/products.json?vendor=${encodeURIComponent(email)}&limit=250`
    )
    if (!rProducts.ok) {
      return jsonWithCors(
        req,
        {
          ok: false,
          error: `Shopify products ${rProducts.status}`,
          detail: rProducts.text,
        },
        { status: rProducts.status }
      )
    }

    const products: any[] = rProducts.json?.products || []
    const productIds = products.map(p => p.id as number)

    // Mapping pour stats par produit
    const statsByProduct: Record<
      number,
      {
        id: number
        title: string
        image_url: string
        salesTotal: number
        salesLast7Days: number
        viewsTotal: number | null
        viewsLast7Days: number | null
      }
    > = {}

    for (const p of products) {
      statsByProduct[p.id] = {
        id: p.id,
        title: p.title,
        image_url: p.image?.src || '',
        salesTotal: 0,
        salesLast7Days: 0,
        viewsTotal: null,
        viewsLast7Days: null,
      }
    }

    // 2) (optionnel) VUES via métachamps mkt.views_total / mkt.views_7d
    //    -> ces métachamps doivent être alimentés par un autre mécanisme de tracking.
    for (const p of products) {
      const pid = p.id as number
      const viewsTotalStr = await getProductMetafieldValue(
        pid,
        'mkt',
        'views_total'
      )
      const views7dStr = await getProductMetafieldValue(
        pid,
        'mkt',
        'views_7d'
      )

      if (viewsTotalStr != null) {
        statsByProduct[pid].viewsTotal = Number(viewsTotalStr) || 0
      }
      if (views7dStr != null) {
        statsByProduct[pid].viewsLast7Days = Number(views7dStr) || 0
      }
    }

    // 3) VENTES : analyse des commandes payées sur les 90 derniers jours
    const now = new Date()
    const since = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
    const sinceIso = since.toISOString()

    const rOrders = await shopifyFetch(
      `/orders.json?status=any&financial_status=paid&created_at_min=${encodeURIComponent(
        sinceIso
      )}&limit=250&fields=id,created_at,line_items`
    )

    if (!rOrders.ok) {
      return jsonWithCors(
        req,
        {
          ok: false,
          error: `Shopify orders ${rOrders.status}`,
          detail: rOrders.text,
        },
        { status: rOrders.status }
      )
    }

    const orders: any[] = rOrders.json?.orders || []
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

    for (const order of orders) {
      const createdAt = new Date(order.created_at)
      const isLast7Days = createdAt >= sevenDaysAgo

      const lineItems: any[] = order.line_items || []
      for (const li of lineItems) {
        // On ne compte que les lignes dont le vendor = email du formateur
        const liVendor = (li.vendor || '').trim()
        if (liVendor.toLowerCase() !== email.toLowerCase()) continue

        const pid = li.product_id as number
        if (!pid || !statsByProduct[pid]) continue

        const qty = Number(li.quantity || 1)
        statsByProduct[pid].salesTotal += qty
        if (isLast7Days) {
          statsByProduct[pid].salesLast7Days += qty
        }
      }
    }

    // 4) Construire la liste finale + top cours
    const items = Object.values(statsByProduct).map(s => {
      const views7 = s.viewsLast7Days ?? 0
      const conv7 =
        views7 > 0 ? s.salesLast7Days / views7 : null

      return {
        id: s.id,
        title: s.title,
        image_url: s.image_url,
        salesTotal: s.salesTotal,
        salesLast7Days: s.salesLast7Days,
        viewsTotal: s.viewsTotal,
        viewsLast7Days: s.viewsLast7Days,
        conversionRate7d: conv7,
      }
    })

    // Totaux globaux
    const totals = items.reduce(
      (acc, it) => {
        acc.salesTotal += it.salesTotal || 0
        acc.salesLast7Days += it.salesLast7Days || 0
        acc.viewsTotal += it.viewsTotal || 0
        acc.viewsLast7Days += it.viewsLast7Days || 0
        return acc
      },
      {
        salesTotal: 0,
        salesLast7Days: 0,
        viewsTotal: 0,
        viewsLast7Days: 0,
      }
    )

    const convGlobal7d =
      totals.viewsLast7Days > 0
        ? totals.salesLast7Days / totals.viewsLast7Days
        : null

    // Top formations par ventes sur 7 jours (ou totales si toutes à 0)
    const has7d = items.some(it => (it.salesLast7Days || 0) > 0)
    const sorted = [...items].sort((a, b) => {
      const ka = has7d ? (a.salesLast7Days || 0) : (a.salesTotal || 0)
      const kb = has7d ? (b.salesLast7Days || 0) : (b.salesTotal || 0)
      return kb - ka
    })
    const topCourses = sorted.slice(0, 5)

    return jsonWithCors(req, {
      ok: true,
      items,
      totals: {
        ...totals,
        conversionRate7d: convGlobal7d,
      },
      topCourses,
    })
  } catch (e: any) {
    return jsonWithCors(
      req,
      { ok: false, error: e?.message || 'stats_failed' },
      { status: 500 }
    )
  }
}
