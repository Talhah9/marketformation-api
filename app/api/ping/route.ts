// app/api/ping/route.ts
import { NextResponse } from 'next/server';

export async function GET() {
  const flags = {
    // Shopify
    SHOP_DOMAIN: !!process.env.SHOP_DOMAIN || !!process.env.SHOPIFY_STORE_DOMAIN,
    ADMIN_TOKEN: !!(process.env.ADMIN_TOKEN || process.env.SHOP_ADMIN_TOKEN || process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN),
    APP_PROXY_SHARED_SECRET: !!process.env.APP_PROXY_SHARED_SECRET,

    // CORS
    CORS_ORIGINS: !!process.env.CORS_ORIGINS,

    // Stripe
    STRIPE_SECRET_KEY: !!process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: !!process.env.STRIPE_WEBHOOK_SECRET,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: !!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    STRIPE_PRODUCT_ID: !!process.env.STRIPE_PRODUCT_ID,
    STRIPE_PRICE_STARTER: !!process.env.STRIPE_PRICE_STARTER,
    STRIPE_PRICE_PRO: !!process.env.STRIPE_PRICE_PRO,
    STRIPE_PRICE_BUSINESS: !!process.env.STRIPE_PRICE_BUSINESS,

    // Blob
    BLOB_READ_WRITE_TOKEN: !!process.env.BLOB_READ_WRITE_TOKEN,
  };
  return NextResponse.json({ ok: true, flags, ts: Date.now() });
}
