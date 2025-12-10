// app/webhooks/shopify/orders/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    let order: any;

    try {
      order = JSON.parse(rawBody);
    } catch (e) {
      console.error('[MF][orders-webhook] ❌ invalid JSON', e);
      return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
    }

    const email: string | null = order.email
      ? String(order.email).toLowerCase().trim()
      : null;

    if (!email || !Array.isArray(order.line_items)) {
      console.warn('[MF][orders-webhook] no email or line_items', {
        email,
        line_items_count: order.line_items?.length || 0,
      });
      return NextResponse.json({ ok: true, skipped: true });
    }

    const shopifyCustomerId: string | null = order.customer?.id
      ? String(order.customer.id)
      : null;

    const shopifyOrderId   = String(order.id);
    const shopifyOrderName = order.name ? String(order.name) : null;

    console.log('[MF][orders-webhook] processing order', {
      email,
      order_id: shopifyOrderId,
      line_items: order.line_items.length,
    });

    for (const item of order.line_items as any[]) {
      if (!item) continue;

      const productId = item.product_id ? String(item.product_id) : null;
      if (!productId) {
        console.warn('[MF][orders-webhook] line_item without product_id', {
          line_item_id: item.id,
        });
        continue;
      }

      // 🔎 On cherche le Course correspondant à ce produit Shopify
      let course: any = null;
      try {
        course = await (prisma as any).course.findFirst({
          where: { shopifyProductId: productId },
        });
      } catch (err) {
        console.error('[MF][orders-webhook] findFirst course failed', {
          productId,
          error: err,
        });
      }

      if (!course) {
        console.warn('[MF][orders-webhook] no Course found for product', {
          productId,
          line_item_id: item.id,
        });
        // on ne crée pas de StudentCourse si aucun Course lié
        continue;
      }

      try {
        await (prisma as any).studentCourse.create({
  data: {
    studentEmail: email,
    shopifyCustomerId,
    shopifyOrderId,
    shopifyLineItemId: String(item.id),
    shopifyProductId: productId,
    shopifyProductTitle: String(item.name ?? ''),
    courseId: course.id,
    purchaseDate: order.created_at
      ? new Date(order.created_at)
      : new Date(), // optionnel, mais propre
  },
});

        console.log('[MF][orders-webhook] ✅ StudentCourse created', {
          email,
          productId,
          courseId: course.id,
        });
      } catch (err) {
        console.error('[MF][orders-webhook] ❌ studentCourse.create failed', {
          email,
          productId,
          courseId: course.id,
          error: err,
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[MF][orders-webhook] ❌ unexpected error', e);
    return NextResponse.json({ ok: false, error: 'internal_error' }, { status: 500 });
  }
}
