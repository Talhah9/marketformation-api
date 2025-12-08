// app/api/webhooks/shopify/orders/route.ts
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';

// On force le runtime Node pour pouvoir utiliser "crypto" de Node
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Petit helper pour calmer TypeScript sur timingSafeEqual
function timingSafeEqual(a: Buffer, b: Buffer) {
  if (a.length !== b.length) return false;
  return (crypto as any).timingSafeEqual(a, b);
}

function verifyShopifyHmac(rawBody: string, hmacHeader: string | null) {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret || !hmacHeader) return false;

  const digest = crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('base64');

  const hmacBuffer = Buffer.from(hmacHeader, 'utf8');
  const digestBuffer = Buffer.from(digest, 'utf8');

  if (hmacBuffer.length !== digestBuffer.length) return false;

  return timingSafeEqual(hmacBuffer, digestBuffer);
}

// On cast prisma en any pour éviter les erreurs "course / studentCourse n'existe pas"
const db = prisma as any;

export async function POST(req: Request) {
  try {
    const rawBody = await req.text(); // body brut pour la signature
    const hmacHeader = req.headers.get('x-shopify-hmac-sha256');
    const topic = req.headers.get('x-shopify-topic') || '';
    const shopDomain = req.headers.get('x-shopify-shop-domain') || '';

    if (!verifyShopifyHmac(rawBody, hmacHeader)) {
      console.warn('[Webhook Shopify] HMAC invalide');
      return new NextResponse('Invalid HMAC', { status: 401 });
    }

    // On ne traite que les commandes payées / créées
    if (topic !== 'orders/paid' && topic !== 'orders/create') {
      console.log('[Webhook Shopify] topic ignoré :', topic);
      return NextResponse.json({ ok: true, ignored: true });
    }

    const payload = JSON.parse(rawBody);

    const email: string | null =
      payload.email || payload.customer?.email || null;

    const shopifyCustomerId: string | null = payload.customer?.id
      ? String(payload.customer.id)
      : null;

    const shopifyOrderId: string = String(payload.id);

    if (!email) {
      console.warn(
        '[Webhook Shopify] Pas d’email sur la commande, on ignore.',
        { shopDomain, shopifyOrderId }
      );
      return NextResponse.json({ ok: true, skipped: 'no_email' });
    }

    const lineItems: any[] = payload.line_items || [];
    if (!lineItems.length) {
      return NextResponse.json({ ok: true, skipped: 'no_line_items' });
    }

    let createdCount = 0;

    for (const li of lineItems) {
      const productId = li.product_id ? String(li.product_id) : null;
      const lineItemId = li.id ? String(li.id) : null;
      if (!productId) continue;

      // 1) On vérifie si le product_id correspond à un Course
      const course = await db.course.findUnique({
        where: { shopifyProductId: productId },
      });

      if (!course) {
        // Produit non géré par MarketFormation → on ignore
        continue;
      }

      // 2) Idempotence : on ne recrée pas si déjà présent
      const existing = await db.studentCourse.findFirst({
        where: {
          courseId: course.id,
          shopifyOrderId,
          shopifyLineItemId: lineItemId,
        },
      });

      if (existing) continue;

      // 3) Création de l’inscription élève
      await db.studentCourse.create({
        data: {
          studentEmail: email,
          shopifyCustomerId,
          courseId: course.id,
          shopifyOrderId,
          shopifyLineItemId: lineItemId,
          status: 'IN_PROGRESS',
          purchaseDate: payload.created_at
            ? new Date(payload.created_at)
            : new Date(),
        },
      });

      createdCount += 1;
    }

    console.log('[Webhook Shopify] Traitement terminé', {
      shopDomain,
      shopifyOrderId,
      createdCount,
    });

    return NextResponse.json({ ok: true, created: createdCount });
  } catch (err) {
    console.error('[Webhook Shopify] Erreur serveur', err);
    return new NextResponse('Server error', { status: 500 });
  }
}
