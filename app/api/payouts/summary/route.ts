// app/api/payouts/summary/route.ts
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getCurrentTrainer } from '@/lib/authTrainer';

// CORS fixe (prod Shopify)
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://marketformation.fr',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Helper JSON + CORS
function json(data: any, status: number = 200): NextResponse {
  return new NextResponse(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}

function maskIban(iban?: string | null) {
  if (!iban) return null;
  const clean = iban.replace(/\s+/g, '');
  if (clean.length <= 8) return clean;
  return clean.slice(0, 4) + '••••••' + clean.slice(-4);
}

// Préflight CORS
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function GET(req: NextRequest) {
  try {
    // On garde req uniquement pour l’auth
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

    return json({
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
      return json({ error: 'Non authentifié.' }, 401);
    }

    return json(
      { error: 'Erreur serveur lors du chargement du solde.' },
      500,
    );
  }
}
