// app/api/payouts/summary/route.ts
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

export const runtime = 'nodejs';

// ----- Config env -----
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const CORS_ORIGINS = process.env.CORS_ORIGINS || ''; // ex: "https://tqiccz-96.myshopify.com,https://marketformation.fr"

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

// ----- Helpers CORS -----
function getCorsOrigin(req: NextRequest): string | null {
  const origin = req.headers.get('origin');
  if (!origin) return null;

  const allowed = CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  if (allowed.length === 0) return origin; // si pas configuré, on laisse passer

  if (allowed.includes(origin)) return origin;

  return null;
}

function withCors(response: NextResponse, origin: string | null) {
  if (origin) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Vary', 'Origin');
  }
  response.headers.set('Access-Control-Allow-Credentials', 'true');
  response.headers.set(
    'Access-Control-Allow-Headers',
    'Content-Type,Authorization'
  );
  response.headers.set('Access-Control-Allow-Methods', 'GET,OPTIONS');
  return response;
}

// ----- OPTIONS (préflight) -----
export async function OPTIONS(req: NextRequest) {
  const origin = getCorsOrigin(req);
  const res = new NextResponse(null, { status: 204 });
  return withCors(res, origin);
}

// ----- GET /api/payouts/summary -----
export async function GET(req: NextRequest) {
  const origin = getCorsOrigin(req);

  if (!stripe) {
    const res = NextResponse.json(
      { ok: false, error: 'Stripe non configuré (STRIPE_SECRET_KEY manquant)' },
      { status: 500 }
    );
    return withCors(res, origin);
  }

  try {
    // 1) Solde Stripe (available / pending)
    const balance = await stripe.balance.retrieve();

    const available = balance.available?.[0] || null;
    const pending = balance.pending?.[0] || null;

    // 2) Derniers payouts (par ex. 10 derniers)
    const payouts = await stripe.payouts.list({
      limit: 10,
    });

    // 3) Prochain payout "en transit" (optionnel)
    const upcoming = payouts.data.find(
      (p) => p.status === 'in_transit' || p.status === 'pending'
    ) || null;

    const payload = {
      ok: true,
      balance: {
        available: available
          ? {
              amount: available.amount,
              currency: available.currency,
            }
          : null,
        pending: pending
          ? {
              amount: pending.amount,
              currency: pending.currency,
            }
          : null,
      },
      upcoming: upcoming
        ? {
          id: upcoming.id,
          amount: upcoming.amount,
          currency: upcoming.currency,
          status: upcoming.status,
          arrival_date: upcoming.arrival_date,
        }
        : null,
      payouts: payouts.data.map((p) => ({
        id: p.id,
        amount: p.amount,
        currency: p.currency,
        status: p.status,
        arrival_date: p.arrival_date,
        created: p.created,
        method: p.method,
        type: p.type,
      })),
    };

    const res = NextResponse.json(payload, { status: 200 });
    return withCors(res, origin);
  } catch (err: any) {
    console.error('[MF] /api/payouts/summary error', err);

    const message =
      err?.message ||
      err?.toString?.() ||
      'Erreur serveur lors du chargement du solde.';

    const res = NextResponse.json(
      { ok: false, error: 'server_error', message },
      { status: 500 }
    );
    return withCors(res, origin);
  }
}
