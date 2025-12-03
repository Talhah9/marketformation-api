// app/api/webhooks/shopify/order-paid/route.ts
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

const SHOPIFY_WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET;

// Vérif HMAC Shopify
function verifyShopifyHmac(rawBody: string, hmacHeader: string | null) {
  if (!SHOPIFY_WEBHOOK_SECRET || !hmacHeader) return false;

  const digest = crypto
    .createHmac('sha256', SHOPIFY_WEBHOOK_SECRET)
    .update(rawBody, 'utf8')
    .digest('base64');

  return crypto.timingSafeEqual(
    Buffer.from(digest, 'utf8'),
    Buffer.from(hmacHeader, 'utf8'),
  );
}

// Récupère le formateur depuis le produit (metafield ou vendor)
function getTrainerIdFromLineItem(line: any): string | null {
  // 1) Metafield mfapp.trainer_id si dispo
  if (line.properties && Array.isArray(line.properties)) {
    const mf = line.properties.find(
      (p: any) =>
        p.name === 'mfapp.trainer_id' ||
        p.name === 'trainer_id' ||
        p.name === 'trainerId',
    );
    if (mf && mf.value) return String(mf.value);
  }

  // 2) Sinon vendor = email formateur
  if (line.vendor) return String(line.vendor);

  return null;
}

export async function POST(req: NextRequest) {
  try {
    const hmacHeader = req.headers.get('x-shopify-hmac-sha256');
    const topic = req.headers.get('x-shopify-topic') || '';
    const shopDomain = req.headers.get('x-shopify-shop-domain') || '';

    const rawBody = await req.text();

    if (!verifyShopifyHmac(rawBody, hmacHeader)) {
      console.error('[MF] Webhook Shopify HMAC invalide');
      return new NextResponse('Unauthorized', { status: 401 });
    }

    if (!topic.startsWith('orders/')) {
      // On n'écoute que les orders.*
      return new NextResponse('Ignored', { status: 200 });
    }

    const payload = JSON.parse(rawBody);

    // ⬇️ Import dynamique pour éviter les soucis au build
    const { creditTrainerSale } = await import('@/lib/payouts');

    const currency = payload.currency || payload.presentment_currency || 'EUR';
    const orderId = payload.id;
    const orderName = payload.name;

    const lineItems = payload.line_items || [];

    for (const line of lineItems) {
      const trainerId = getTrainerIdFromLineItem(line);
      if (!trainerId) continue;

      const qty = Number(line.quantity || 1);
      const price = Number(line.price || 0);
      if (!price || !qty) continue;

      const amount = price * qty; // Pour l’instant: 100% pour le formateur

      await creditTrainerSale(trainerId, amount, currency, {
        shop: shopDomain,
        orderId,
        orderName,
        lineItemId: line.id,
        productId: line.product_id,
        title: line.title,
      });
    }

    return new NextResponse('OK', { status: 200 });
  } catch (err) {
    console.error('[MF] Webhook Shopify /order-paid error', err);
    return new NextResponse('Server error', { status: 500 });
  }
}
