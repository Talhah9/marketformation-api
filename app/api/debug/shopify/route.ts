// app/api/debug/shopify/route.ts
import { jsonWithCors, handleOptions } from '@/app/api/_lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(req: Request) {
  return handleOptions(req);
}

export async function GET(req: Request) {
  const info = {
    domain: process.env.SHOP_DOMAIN,
    hasToken: !!(process.env.SHOP_ADMIN_TOKEN || process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN || process.env.ADMIN_TOKEN),
  };
  return jsonWithCors(req, { ok: true, info });
}
