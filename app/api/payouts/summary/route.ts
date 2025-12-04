// app/api/payouts/summary/route.ts
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

export const runtime = 'nodejs';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const CORS_ORIGINS = process.env.CORS_ORIGINS || '';

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

// ---- CORS helpers ----
function getCorsOrigin(req: NextRequest): string | null {
  const origin = req.headers.get('origin');
  if (!origin) return null;

  const allowed = CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  if (allowed.length === 0) return origin;
  if (allowed.includes(origin)) return origin;

  return null;
}

function withCors(res: NextResponse, origin: string | null) {
  if (origin) {
    res.headers.set('Access-Control-Allow-Origin', origin);
    res.headers.set('Vary', 'Origin');
  }
  res.headers.set('Access-Control-Allow-Credentials', 'true');
  res.headers.set(
    'Access-Control-Allow-Headers',
    'Content-Type,Authorization'
  );
  res.headers.set('Access-Control-Allow-Methods', 'GET,OPTIONS');
  return res;
}

export async function OPTIONS(req: NextRequest) {
  const origin = getCorsOrigin(req);
  const res = new NextResponse(null, { status: 204 });
  return withCors(res, origin);
}

export async function GET(req: NextRequest) {
  const origin = getCorsOrigin(req);

  try {
    if (!stripe) {
      const res = NextResponse.json(
        {
          ok: false,
          error: 'stripe_not_configured',
          message: 'STRIPE_SECRET_KEY manquant en production.',
        },
        { status: 200 } // <-- jamais 500/401 ici
      );
      return withCors(res, origin);
    }

    // 1) Solde
    const balance = await stripe.balance.retrieve();
    const available = balance.available?.[0] || null;
    const pending = balance.pending?.[0] || null;

    // 2) Payouts récents
    const payouts = await stripe.payouts.list({ limit: 10 });

    // 3) Payout prochain / en transit
    const upcoming =
      payouts.data.find(
        (p) => p.status === 'in_transit' || p.status === 'pending'
      ) || null;

    const payload = {
      ok: true,
      balance: {
        available: available
          ? { amount: available.amount, currency: available.currency }
          : null,
        pending: pending
          ? { amount: pending.amount, currency: pending.currency }
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

    const res = NextResponse.json(
      {
        ok: false,
        error: 'server_error',
        message:
          err?.message ||
          err?.toString?.() ||
          'Erreur serveur lors du chargement du solde.',
      },
      { status: 200 } // <-- même en erreur, on reste en 200
    );
    return withCors(res, origin);
  }
}
