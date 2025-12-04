// app/api/payouts/summary/route.ts

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';

// --- CORS helper ---
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

function corsHeaders(origin: string | null) {
  const allowed =
    origin && ALLOWED_ORIGINS.length > 0 && ALLOWED_ORIGINS.includes(origin)
      ? origin
      : ALLOWED_ORIGINS[0] ?? '*';

  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  };
}

// Préflight
export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get('origin');
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(origin),
  });
}

function maskIban(iban?: string | null) {
  if (!iban) return null;
  const clean = iban.replace(/\s+/g, '');
  if (clean.length <= 8) return clean;
  return clean.slice(0, 4) + '••••••' + clean.slice(-4);
}

export async function GET(req: NextRequest) {
  const origin = req.headers.get('origin');
  const baseHeaders = corsHeaders(origin);

  try {
    if (!process.env.DATABASE_URL) {
      console.error('[MF] DATABASE_URL manquante sur le serveur');
      return NextResponse.json(
        { error: 'Configuration serveur invalide.' },
        { status: 500, headers: baseHeaders },
      );
    }

    // Import dynamique pour éviter les crashs au build
    const [{ getCurrentTrainer }, { prisma }] = await Promise.all([
      import('@/lib/authTrainer'),
      import('@/lib/db'),
    ]);

    const { trainerId } = await getCurrentTrainer(req);

    const [banking, summary, history] = await Promise.all([
      prisma.trainerBanking.findUnique({ where: { trainerId } }),
      prisma.payoutsSummary.findUnique({ where: { trainerId } }),
      prisma.payoutsHistory.findMany({
        where: { trainerId },
        orderBy: { date: 'desc' },
        take: 50,
      }),
    ]);

    return NextResponse.json(
      {
        ok: true,
        banking: banking
          ? {
              payoutName: banking.payoutName,
              payoutCountry: banking.payoutCountry,
              payoutIbanMasked: maskIban(banking.payoutIban),
              payoutBic: banking.payoutBic,
              autoPayout: banking.autoPayout,
            }
          : null,
        summary: summary
          ? {
              availableAmount: summary.availableAmount.toNumber(),
              pendingAmount: summary.pendingAmount.toNumber(),
              currency: summary.currency,
              updatedAt: summary.updatedAt,
            }
          : {
              availableAmount: 0,
              pendingAmount: 0,
              currency: 'EUR',
              updatedAt: null,
            },
        history: history.map(h => ({
          id: h.id,
          type: h.type,
          status: h.status,
          amount: h.amount.toNumber(),
          currency: h.currency,
          date: h.date,
          meta: h.meta ?? null,
        })),
      },
      { status: 200, headers: baseHeaders },
    );
  } catch (err: any) {
    console.error('[MF] GET /api/payouts/summary error', err);

    if (err instanceof Error && err.message === 'Trainer not authenticated') {
      return NextResponse.json(
        { error: 'Non authentifié.' },
        { status: 401, headers: baseHeaders },
      );
    }

    return NextResponse.json(
      { error: 'Erreur serveur lors du chargement du solde.' },
      { status: 500, headers: baseHeaders },
    );
  }
}
