import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  const flags = {
    SHOP_DOMAIN: !!(process.env.SHOP_DOMAIN || process.env.SHOPIFY_STORE_DOMAIN),
    ADMIN_TOKEN: !!(process.env.SHOP_ADMIN_TOKEN || process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN || process.env.ADMIN_TOKEN),
    APP_PROXY_SHARED_SECRET: !!process.env.APP_PROXY_SHARED_SECRET,
    CORS_ORIGINS: !!process.env.CORS_ORIGINS,
    STRIPE_SECRET_KEY: !!process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: !!(process.env.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET_PLATFORM),
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: !!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    STRIPE_PRICE_STARTER: !!process.env.STRIPE_PRICE_STARTER,
    STRIPE_PRICE_PRO: !!process.env.STRIPE_PRICE_PRO,
    STRIPE_PRICE_BUSINESS: !!process.env.STRIPE_PRICE_BUSINESS,
    BLOB_READ_WRITE_TOKEN: !!process.env.BLOB_READ_WRITE_TOKEN,
    S3_ACCESS_KEY_ID: !!process.env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: !!process.env.S3_SECRET_ACCESS_KEY,
    S3_BUCKET: !!process.env.S3_BUCKET,
    S3_REGION: !!process.env.S3_REGION,
    S3_PUBLIC_BASE: !!process.env.S3_PUBLIC_BASE,
  };
  return NextResponse.json({ ok: true, flags, ts: Date.now() }, { headers: { "Cache-Control": "no-store" } });
}