// app/api/payouts/summary/route.ts
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// --- Helpers CORS simples (comme tes autres routes publiques) ---
function withCors(req: NextRequest, res: NextResponse) {
  const origin = req.headers.get('origin') || '';
  const allowed =
    process.env.CORS_ORIGINS
      ?.split(',')
      .map((o) => o.trim())
      .filter(Boolean) || [];

  if (allowed.length === 0) {
    // fallback : autorise Shopify + le domaine public
    const fallback = ['https://marketformation.fr', 'https://tqiccz-96.myshopify.com'];
    if (fallback.includes(origin)) {
      res.headers.set('Access-Control-Allow-Origin', origin);
      res.headers.set('Vary', 'Origin');
    }
  } else if (allowed.includes(origin)) {
    res.headers.set('Access-Control-Allow-Origin', origin);
    res.headers.set('Vary', 'Origin');
  }

  res.headers.set('Access-Control-Allow-Credentials', 'true');
  res.headers.set(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );
  res.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');

  return res;
}

export async function OPTIONS(req: NextRequest) {
  const res = NextResponse.json({ ok: true });
  return withCors(req, res);
}

// --- Stripe client ---
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

if (!STRIPE_SECRET_KEY) {
  console.warn('[MF] STRIPE_SECRET_KEY manquante pour /api/payouts/summary');
}

const stripe = STRIPE_SECRET_KEY
  ? new Stripe(STRIPE_SECRET_KEY)
  : null;


// --- Type de réponse envoyé au front ---
type PayoutItem = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  arrivalDate: string | null;
  createdAt: string;
};

type PayoutSummary = {
  lifetimePaid: number; // total des virements déjà payés
  upcomingAmount: number; // montant des prochains virements en "pending"
  lastPayoutAmount: number | null;
  lastPayoutDate: string | null;
  currency: string;
};

export async function GET(req: NextRequest) {
  try {
    if (!stripe) {
      const res = NextResponse.json(
        {
          ok: false,
          error: 'Stripe non configuré',
        },
        { status: 500 }
      );
      return withCors(req, res);
    }

    // On récupère une liste de virements Stripe (payouts)
    // On limite à 50 pour rester léger, suffisant pour un résumé sur le dashboard
    const payoutsList = await stripe.payouts.list({
      limit: 50,
    });

    const payouts: PayoutItem[] = payoutsList.data.map((p) => ({
      id: p.id,
      amount: (p.amount || 0) / 100, // Stripe est en cents
      currency: p.currency || 'eur',
      status: p.status,
      arrivalDate: p.arrival_date
        ? new Date(p.arrival_date * 1000).toISOString()
        : null,
      createdAt: new Date(p.created * 1000).toISOString(),
    }));

    // Devise principale (on prend la première, sinon "eur")
    const currency =
      payouts[0]?.currency || payoutsList.data[0]?.currency || 'eur';

    // Total déjà payé
    const lifetimePaid = payouts
      .filter((p) => p.status === 'paid')
      .reduce((sum, p) => sum + p.amount, 0);

    // Montant des virements en attente (pending / in_transit)
    const upcomingAmount = payouts
      .filter((p) => p.status === 'pending' || p.status === 'in_transit')
      .reduce((sum, p) => sum + p.amount, 0);

    // Dernier virement payé (tri par date)
    const paidPayouts = [...payouts].filter((p) => p.status === 'paid');
    paidPayouts.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    const lastPayout = paidPayouts[0] || null;

    const summary: PayoutSummary = {
      lifetimePaid,
      upcomingAmount,
      lastPayoutAmount: lastPayout ? lastPayout.amount : null,
      lastPayoutDate: lastPayout ? lastPayout.createdAt : null,
      currency,
    };

    const res = NextResponse.json(
      {
        ok: true,
        summary,
        payouts,
      },
      { status: 200 }
    );

    return withCors(req, res);
  } catch (err: any) {
    console.error('[MF] GET /api/payouts/summary error', err);

    const res = NextResponse.json(
      {
        ok: false,
        error: 'Internal Server Error',
      },
      { status: 500 }
    );
    return withCors(req, res);
  }
}
