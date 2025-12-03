// app/api/payouts/summary/route.ts
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getCurrentTrainer } from '@/lib/authTrainer';

const ALLOWED_ORIGINS = [
  'https://marketformation.fr',
  'https://tqiccz-96.myshopify.com', // dev store (garde / enlève si besoin)
];

// Détermine l’origin à renvoyer pour CORS
function getCorsHeaders(req: NextRequest) {
  const origin = req.headers.get('origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin)
    ? origin
    : ALLOWED_ORIGINS[0];

  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function maskIban(iban?: string | null) {
  if (!iban) return null;
  const clean = iban.replace(/\s+/g, '');
  if (clean.length <= 8) return clean;
  return clean.slice(0, 4) + '••••••' + clean.slice(-4);
}

// Petit helper pour renvoyer du JSON avec CORS
function json(
  req: NextRequest,
  data: any,
  status: number = 200,
): NextResponse {
  return new NextResponse(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...getCorsHeaders(req),
    },
  });
}

// Préflight CORS
export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(req),
  });
}

export async function GET(req: NextRequest) {
  try {
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

    return json(req, {
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
      history: history.map((h) => ({
        id: h.id,
        type: h.type,
        status: h.status,
        amount: h.amount.toNumber(),
        currency: h.currency,
        date: h.date,
        meta: h.meta ?? null,
      })),
    });
  } catch (err: any) {
    console.error('[MF] GET /api/payouts/summary error', err);

    if (err instanceof Error && err.message === 'Trainer not authenticated') {
      return json(req, { error: 'Non authentifié.' }, 401);
    }

    return json(
      req,
      { error: 'Erreur serveur lors du chargement du solde.' },
      500,
    );
  }
}
