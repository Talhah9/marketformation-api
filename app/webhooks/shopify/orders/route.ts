// app/webhooks/shopify/orders/route.ts
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Récupère le secret utilisé par Shopify pour signer les webhooks.
 */
function getWebhookSecret(): string {
  return (
    process.env.SHOPIFY_WEBHOOK_SECRET || // ton vrai secret de webhook
    process.env.SHOPIFY_SHARED_SECRET ||  // fallback éventuel
    ''
  );
}

/**
 * Vérifie la signature HMAC envoyée par Shopify.
 * Typage volontairement large (any) pour éviter les erreurs TS avec Buffer.
 */
function verifyShopifySignature(
  body: any,
  hmacHeader: string | null,
): boolean {
  const secret = getWebhookSecret();
  if (!secret || !hmacHeader) return false;

  const generated = crypto
    .createHmac('sha256', secret)
    .update(body as any)
    .digest('base64');

  const safeGenerated = Buffer.from(generated, 'utf8');
  const safeHeader    = Buffer.from(hmacHeader, 'utf8');

  if (safeGenerated.length !== safeHeader.length) return false;

  // cast en any pour éviter le bug ArrayBufferView
  return crypto.timingSafeEqual(
    safeGenerated as any,
    safeHeader as any,
  );
}

export async function POST(req: Request) {
  // on lit le raw body pour la signature ET le JSON
  const rawBody = await req.text();
  const hmacHeader = req.headers.get('x-shopify-hmac-sha256');

  if (!verifyShopifySignature(rawBody, hmacHeader)) {
    console.warn('[MF][orders-webhook] invalid HMAC');
    return NextResponse.json({ ok: false, error: 'invalid_hmac' }, { status: 401 });
  }

  let order: any;
  try {
    order = JSON.parse(rawBody);
  } catch (e) {
    console.error('[MF][orders-webhook] invalid JSON', e);
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  try {
    const email: string | null = order.email
      ? String(order.email).toLowerCase().trim()
      : null;

    const shopifyCustomerId: string | null = order.customer?.id
      ? String(order.customer.id)
      : null;

    const shopifyOrderId   = String(order.id);
    const shopifyOrderName = order.name ? String(order.name) : null;

    if (!Array.isArray(order.line_items) || !email) {
      console.warn('[MF][orders-webhook] no line_items or email', {
        email,
        line_items_count: order.line_items?.length || 0,
      });
      // 200 pour éviter les retries Shopify
      return NextResponse.json({ ok: true, skipped: true });
    }

    console.log('[MF][orders-webhook] processing order', {
      email,
      order_id: shopifyOrderId,
      line_items: order.line_items.length,
    });

    for (const item of order.line_items as any[]) {
      if (!item) continue;

      // 🔎 heuristique : tes produits “formations” ont comme vendor l’email du formateur
      const vendor = item.vendor ? String(item.vendor) : '';
      const looksLikeCourse = vendor.includes('@');

      if (!looksLikeCourse) {
        continue;
      }

      try {
        await (prisma as any).studentCourse.create({
          data: {
            studentEmail: email,
            shopifyCustomerId,
            shopifyOrderId,
            shopifyOrderNumber: shopifyOrderName,
            shopifyLineItemId: String(item.id),
            shopifyProductId: item.product_id ? String(item.product_id) : null,
            shopifyProductTitle: String(item.name ?? ''),
            status: 'IN_PROGRESS', // enum Prisma
          },
        });
      } catch (err) {
        console.error('[MF][orders-webhook] prisma.studentCourse.create failed', {
          order_id: shopifyOrderId,
          line_item_id: item.id,
          error: err,
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[MF][orders-webhook] unexpected error', e);
    return NextResponse.json({ ok: false, error: 'internal_error' }, { status: 500 });
  }
}
