// app/api/student/courses/route.ts
import { NextRequest, NextResponse } from 'next/server';

const SHOP_DOMAIN = process.env.SHOP_DOMAIN;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

const SHOPIFY_API_VERSION = '2024-01';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

async function fetchShopify(path: string, init?: RequestInit) {
  if (!SHOP_DOMAIN || !ADMIN_TOKEN) {
    throw new Error('SHOP_DOMAIN_or_ADMIN_TOKEN_missing');
  }

  const url = `https://${SHOP_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}${path}`;

  const res = await fetch(url, {
    ...init,
    headers: {
      'X-Shopify-Access-Token': ADMIN_TOKEN,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(init?.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('[MF] Shopify error', res.status, text);
    throw new Error(`shopify_${res.status}`);
  }

  return res.json();
}

// Cache simple pour éviter d'appeler 10 fois le même produit
const productCache = new Map<string, any>();

async function getProductWithMetafields(productId: number | string) {
  const key = String(productId);
  if (productCache.has(key)) {
    return productCache.get(key);
  }

  // 1) Produit
  const productData = await fetchShopify(`/products/${productId}.json`);
  const product = productData.product;

  // 2) Metafields du produit (namespace "mfapp")
  const metafieldsData = await fetchShopify(
    `/metafields.json?metafield[owner_resource]=product&metafield[owner_id]=${productId}`
  );

  const metafields: any[] = metafieldsData.metafields || [];
  const mfappMeta = metafields.filter((m) => m.namespace === 'mfapp');

  const byKey: Record<string, any> = {};
  mfappMeta.forEach((m) => {
    byKey[m.key] = m;
  });

  const enriched = {
    ...product,
    _mfapp: {
      pdf_url: byKey['pdf_url']?.value || null,
      type: byKey['type']?.value || null,
      level: byKey['level']?.value || null,
      hours: byKey['hours']?.value || null,
      category_label: byKey['category_label']?.value || null,
    },
  };

  productCache.set(key, enriched);
  return enriched;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const email = searchParams.get('email');
    const customerId = searchParams.get('shopifyCustomerId');

    if (!email && !customerId) {
      return jsonError('email_or_customerId_required', 400);
    }

    if (!SHOP_DOMAIN || !ADMIN_TOKEN) {
      return jsonError('server_misconfigured', 500);
    }

    // 1) Récupérer les commandes du client
    let ordersPath = `/orders.json?status=any&financial_status=paid&limit=100`;
    if (customerId) {
      ordersPath += `&customer_id=${encodeURIComponent(customerId)}`;
    } else if (email) {
      ordersPath += `&email=${encodeURIComponent(email)}`;
    }

    const ordersData = await fetchShopify(ordersPath);
    const orders: any[] = ordersData.orders || [];

    if (!orders.length) {
      return NextResponse.json({ ok: true, items: [] });
    }

    // 2) Pour chaque line_item, on construit un courseItem
    const items: any[] = [];

    for (const order of orders) {
      const purchaseDate = order.processed_at || order.created_at;
      const lineItems: any[] = order.line_items || [];

      for (const li of lineItems) {
        // Ignore les lignes sans product_id (ex: shipping)
        if (!li.product_id) continue;

        const productId = li.product_id;

        // Récupérer le produit + metafields (cache)
        const product = await getProductWithMetafields(productId);

        // On ne garde que les produits marqués comme "course" (si tu as mis mfapp.type = "course")
        const type = product._mfapp?.type || null;
        if (type && type !== 'course') {
          continue;
        }

        const pdfUrl = product._mfapp?.pdf_url || null;

        // Image principale
        const image = product.image || null;
        const imageUrl = image?.src || null;

        // URL publique produit
        const handle = product.handle;
        const productUrl = handle
          ? `https://marketformation.fr/products/${handle}`
          : null;

        // Données "cours" retournées à la page élève
        items.push({
          id: `${order.id}_${li.id}`,
          order_id: order.id,
          order_name: order.name,
          product_id: product.id,
          variant_id: li.variant_id,
          title: li.title || product.title,
          subtitle: li.variant_title || '',
          image_url: imageUrl,
          // On commence simple : pas encore de vrai tracking de progression
          status: 'in_progress', // "in_progress" | "completed" | "not_started"
          estimated_hours: product._mfapp?.hours
            ? Number(product._mfapp.hours)
            : null,
          category_label: product._mfapp?.category_label || null,
          level_label: product._mfapp?.level || null,
          purchase_date: purchaseDate,
          last_access_at: null, // tu pourras peupler plus tard
          // Accès :
          access_url: pdfUrl || productUrl,
          download_url: pdfUrl,
          product_url: productUrl,
        });
      }
    }

    // Tri par date d'achat (plus récent en premier)
    items.sort((a, b) => {
      const da = a.purchase_date ? new Date(a.purchase_date).getTime() : 0;
      const db = b.purchase_date ? new Date(b.purchase_date).getTime() : 0;
      return db - da;
    });

    return NextResponse.json({
      ok: true,
      items,
    });
  } catch (err: any) {
    console.error('[MF] /api/student/courses error', err);
    return NextResponse.json(
      {
        ok: false,
        error: err?.message || 'unexpected_error',
      },
      { status: 500 },
    );
  }
}
