// app/api/stripe/portal/route.ts
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY_LIVE as string, {
  apiVersion: '2024-06-20',
});

const ALLOWED = (process.env.ALLOWED_ORIGINS || 'https://tqiccz-96.myshopify.com')
  .split(',')
  .map(s => s.trim());

function corsHeaders(req: Request) {
  const origin = req.headers.get('origin') || '';
  const allow = ALLOWED.includes(origin) ? origin : ALLOWED[0] || '*';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}
function json(req: Request, data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(req) },
  });
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export async function POST(req: Request) {
  try {
    const { email, returnUrl } = await req.json();
    if (!email) return json(req, { error: 'Missing email' }, 400);

    const existing = await stripe.customers.list({ email, limit: 1 });
    const customer = existing.data[0];
    if (!customer) return json(req, { error: 'Customer not found' }, 404);

    const session = await stripe.billingPortal.sessions.create({
      customer: customer.id,
      return_url: returnUrl,
    });

    return json(req, { url: session.url });
  } catch (e: any) {
    console.error('portal error', e);
    return json(req, { error: e?.message || 'portal_failed' }, 500);
  }
}

