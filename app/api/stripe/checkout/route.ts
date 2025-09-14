// app/api/stripe/checkout/route.ts (ou équivalent)
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
    const { priceId, email, returnUrl } = await req.json();

    if (!priceId || !email) {
      return json(req, { error: 'Missing priceId or email' }, 400);
    }

    // retrouver/créer le customer
    const existing = await stripe.customers.list({ email, limit: 1 });
    const customer = existing.data[0] || (await stripe.customers.create({ email }));

    // session checkout en mode SUBSCRIPTION
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customer.id,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: `${returnUrl}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${returnUrl}?checkout=cancelled`,
    });

    // IMPORTANT: renvoyer un JSON, pas de redirect serveur (sinon CORS)
    return json(req, { url: session.url });
  } catch (e: any) {
    console.error('checkout error', e);
    return json(req, { error: e?.message || 'checkout_failed' }, 500);
  }
}

