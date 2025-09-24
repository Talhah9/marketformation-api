// GET /api/debug/shopify  → vérifie les credentials + scope write_files
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const out = {
    domain: process.env.SHOP_DOMAIN,
    hasAdminToken: !!(process.env.SHOP_ADMIN_TOKEN || process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN || process.env.ADMIN_TOKEN),
    apiVersion: process.env.SHOPIFY_API_VERSION || process.env.SHOP_API_VERSION || '2024-07',
  };
  return new Response(JSON.stringify({ ok: true, out }), {
    headers: { 'content-type': 'application/json' },
    status: 200,
  });
}
