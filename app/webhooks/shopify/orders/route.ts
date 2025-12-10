// app/webhooks/shopify/orders/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const bodyText = await req.text();

    console.log('[MF][orders-webhook][DEBUG] raw body =', bodyText);

    let order: any;
    try {
      order = JSON.parse(bodyText);
    } catch (e) {
      console.error('[MF][orders-webhook][DEBUG] invalid JSON', e);
      return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
    }

    const email: string | null = order.email
      ? String(order.email).toLowerCase().trim()
      : null;

    if (!email || !Array.isArray(order.line_items)) {
      console.warn('[MF][orders-webhook][DEBUG] missing email or line_items', {
        email,
        line_items_count: order.line_items?.length || 0,
      });
      return NextResponse.json({ ok: true, skipped: true });
    }

    console.log('[MF][orders-webhook][DEBUG] processing order', {
      order_id: order.id,
      email,
      line_items: order.line_items.length,
    });

    for (const item of order.line_items as any[]) {
      if (!item) continue;

      try {
        await (prisma as any).studentCourse.create({
          data: {
            studentEmail: email,
            shopifyCustomerId: order.customer?.id ? String(order.customer.id) : null,
            shopifyOrderId: String(order.id),
            shopifyOrderNumber: order.name ? String(order.name) : null,
            shopifyLineItemId: String(item.id),
            shopifyProductId: item.product_id ? String(item.product_id) : null,
            shopifyProductTitle: String(item.name ?? ''),
            status: 'IN_PROGRESS',
          },
        });
      } catch (err) {
        console.error('[MF][orders-webhook][DEBUG] prisma.studentCourse.create failed', {
          order_id: order.id,
          line_item_id: item.id,
          error: err,
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[MF][orders-webhook][DEBUG] unexpected error', e);
    return NextResponse.json({ ok: false, error: 'internal_error' }, { status: 500 });
  }
}
