// app/webhooks/shopify/orders/route.ts
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Vérifie la signature HMAC envoyée par Shopify.
 * Typage volontairement large (any) pour éviter les erreurs TS avec Buffer.
 */
function verifyShopifySignature(
  body: any,
  hmacHeader: string | null,
  secret: string,
): boolean {
  if (!hmacHeader || !secret) return false;

  const generated = crypto
    .createHmac('sha256', secret)
    .update(body as any)
    .digest('base64');

  const safeGenerated = Buffer.from(generated, 'utf8');
  const safeHeader    = Buffer.from(hmacHeader, 'utf8');

  if (safeGenerated.length !== safeHeader.length) return false;

  // on caste en any pour contenter TypeScript
  return crypto.timingSafeEqual(
    safeGenerated as any,
    safeHeader as any,
  );
}

/**
 * Shopify enverra ici les webhooks "orders/create" (et éventuellement "orders/paid").
 * But : créer des entrées StudentCourse pour chaque produit qui correspond
 * à une formation (Course) dans ta base Prisma.
 */
export async function POST(req: Request) {
  const secret =
    process.env.SHOPIFY_WEBHOOK_SECRET ||
    process.env.SHOPIFY_WEBHOOK_SHARED_SECRET ||
    process.env.SHOPIFY_API_SECRET_KEY ||
    '';

  if (!secret) {
    console.error('[MF][webhook] Missing SHOPIFY_WEBHOOK_SECRET');
    return new NextResponse('Missing secret', { status: 500 });
  }

  // On récupère le body brut pour la vérif HMAC
  const arrayBuffer = await req.arrayBuffer();
  const rawBody = Buffer.from(arrayBuffer);

  const hmacHeader = req.headers.get('x-shopify-hmac-sha256');
  const topic      = req.headers.get('x-shopify-topic') || '';
  const shopDomain = req.headers.get('x-shopify-shop-domain') || '';

  if (!verifyShopifySignature(rawBody, hmacHeader, secret)) {
    console.warn('[MF][webhook] Invalid signature from Shopify', { shopDomain, topic });
    return new NextResponse('Invalid signature', { status: 401 });
  }

  // On parse le JSON seulement après avoir vérifié la signature
  let payload: any;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch (e) {
    console.error('[MF][webhook] Unable to parse JSON payload', e);
    return new NextResponse('Bad request', { status: 400 });
  }

  // On ne traite vraiment que les orders.*
  if (!topic.startsWith('orders/')) {
    console.log('[MF][webhook] Ignored topic', topic);
    return new NextResponse('OK', { status: 200 });
  }

  try {
    const prismaAny = prisma as any;

    const orderId   = String(payload.id ?? '');
    const createdAt = payload.created_at ? new Date(payload.created_at) : new Date();

    const customer  = payload.customer || {};
    const email     = (customer.email || payload.email || '').toString().trim();
    const customerId =
      customer.id != null ? String(customer.id) : (payload.customer_id ? String(payload.customer_id) : null);

    const lineItems: any[] = Array.isArray(payload.line_items) ? payload.line_items : [];

    if (!email || !lineItems.length) {
      console.log('[MF][webhook] No email or no line items, nothing to create', {
        orderId,
        email,
        lineItemsCount: lineItems.length,
      });
      return new NextResponse('OK', { status: 200 });
    }

    // On récupère tous les product_id de la commande
    const productIds = Array.from(
      new Set(
        lineItems
          .map((li) => li.product_id)
          .filter((id) => id != null)
          .map((id) => String(id)),
      ),
    );

    if (!productIds.length) {
      console.log('[MF][webhook] No product_ids in line items', { orderId });
      return new NextResponse('OK', { status: 200 });
    }

    // On va chercher les Course correspondants dans Prisma
    const courses = await prismaAny.course.findMany({
      where: {
        shopifyProductId: { in: productIds },
      },
    });

    if (!courses.length) {
      console.log('[MF][webhook] No matching courses for order', {
        orderId,
        productIds,
      });
      return new NextResponse('OK', { status: 200 });
    }

    const courseByProductId = new Map<string, any>();
    for (const c of courses) {
      courseByProductId.set(String(c.shopifyProductId), c);
    }

    const creations: any[] = [];

    for (const li of lineItems) {
      const productId = li.product_id != null ? String(li.product_id) : null;
      const lineId    = li.id != null ? String(li.id) : null;

      if (!productId || !courseByProductId.has(productId)) continue;

      const course = courseByProductId.get(productId);

      // (Pour l’instant on crée 1 StudentCourse par line item, pas par quantité)
      creations.push({
        studentEmail:      email,
        shopifyCustomerId: customerId,
        courseId:          course.id,
        shopifyOrderId:    orderId,
        shopifyLineItemId: lineId,
        purchaseDate:      createdAt,
        status:            'IN_PROGRESS',
        archived:          false,
      });
    }

    if (!creations.length) {
      console.log('[MF][webhook] No line items mapped to courses', { orderId });
      return new NextResponse('OK', { status: 200 });
    }

    await prismaAny.studentCourse.createMany({
      data: creations,
    });

    console.log('[MF][webhook] StudentCourse created', {
      orderId,
      email,
      count: creations.length,
    });

    return new NextResponse('OK', { status: 200 });
  } catch (err) {
    console.error('[MF][webhook] Internal error processing order', err);
    // On renvoie quand même 200 pour éviter les retry infinis si bug côté nous
    return new NextResponse('OK', { status: 200 });
  }
}
