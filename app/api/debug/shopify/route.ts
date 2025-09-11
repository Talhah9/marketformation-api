// GET /api/debug/shopify  → vérifie les credentials + scope write_files
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function env(n: string){ const v = process.env[n]; if(!v) throw new Error(`Missing env: ${n}`); return v; }
const apiV = () => (process.env.SHOPIFY_API_VERSION || '2024-07');

export async function GET() {
  const out: any = { ok: false, checks: {} };

  try {
    const shopUrl = `https://${env('SHOPIFY_STORE_DOMAIN')}/admin/api/${apiV()}/shop.json`;
    const r = await fetch(shopUrl, {
      headers: { 'X-Shopify-Access-Token': env('SHOPIFY_ADMIN_API_ACCESS_TOKEN') }
    });
    out.checks.shop = { status: r.status, ok: r.ok };
    if (!r.ok) {
      const t = await r.text();
      out.checks.shop.body = t;
      return new Response(JSON.stringify(out), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
  } catch (e:any) {
    out.checks.shop = { error: e?.message || 'fetch_failed' };
    return new Response(JSON.stringify(out), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  // Test write_files via stagedUploadsCreate (sans envoyer de binaire)
  try {
    const gqlUrl = `https://${env('SHOPIFY_STORE_DOMAIN')}/admin/api/${apiV()}/graphql.json`;
    const res = await fetch(gqlUrl, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': env('SHOPIFY_ADMIN_API_ACCESS_TOKEN'),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: `
          mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
            stagedUploadsCreate(input: $input) {
              stagedTargets { url resourceUrl }
              userErrors { field message }
            }
          }
        `,
        variables: { input: [{ resource:"FILE", filename:"probe.txt", mimeType:"text/plain", httpMethod:"POST" }] }
      })
    });
    const j: any = await res.json();
    out.checks.stagedUploadsCreate = { status: res.status, ok: res.ok, userErrors: j?.data?.stagedUploadsCreate?.userErrors || null, errors: j?.errors || null };
  } catch (e:any) {
    out.checks.stagedUploadsCreate = { error: e?.message || 'gql_failed' };
  }

  out.ok = true;
  return new Response(JSON.stringify(out, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
