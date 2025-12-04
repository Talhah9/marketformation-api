// app/api/payouts/summary/route.ts
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs'; // 👈 ajoute ça

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentTrainer } from '@/lib/authTrainer';
import { prisma } from '@/lib/db';
import { ensureSummaryRow } from '@/lib/payouts';

// CORS pour Shopify (avec cookies/credentials)
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://marketformation.fr',
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function withCors(body: any, status: number = 200) {
  return new NextResponse(JSON.stringify(body), {
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

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function GET(req: NextRequest) {
  try {
    const { trainerId } = await getCurrentTrainer(req);

    await ensureSummaryRow(trainerId);

    const [banking, summaryRow, historyRows, salesAgg] = await Promise.all([
      prisma.trainerBanking.findUnique({
        where: { trainerId },
      }),

      prisma.payoutsSummary.findUnique({
        where: { trainerId },
      }),

      prisma.payoutsHistory.findMany({
        where: { trainerId },
        orderBy: { date: 'desc' },
        take: 50,
      }),

      prisma.payoutsHistory.aggregate({
        where: {
          trainerId,
          type: 'sale',
        },
        _sum: {
          amount: true,
        },
      }),
    ]);

    const totalEarned =
      salesAgg._sum.amount != null ? Number(salesAgg._sum.amount) : 0;

    const available =
      summaryRow?.availableAmount != null
        ? Number(summaryRow.availableAmount)
        : 0;

    const pending =
      summaryRow?.pendingAmount != null
        ? Number(summaryRow.pendingAmount)
        : 0;

    const currency = summaryRow?.currency ?? 'EUR';

    return withCors({
      ok: true,

      banking: banking
        ? {
            payoutName: banking.payoutName,
            payoutCountry: banking.payoutCountry,
            payoutIbanMasked: maskIban(banking.payoutIban),
            payoutBic: banking.payoutBic,
            autoPayout: banking.autoPayout,
            updatedAt: banking.updatedAt ?? null,
          }
        : null,

      summary: {
        totalEarned,
        available,
        availableAmount: available,
        pending,
        pendingAmount: pending,
        currency,
        updatedAt: summaryRow?.updatedAt ?? null,
      },

      history: historyRows.map((h) => ({
        id: h.id,
        type: h.type,
        status: h.status,
        amount: Number(h.amount),
        currency: h.currency,
        date: h.date,
        meta: h.meta ?? null,
      })),
    });
  } catch (err: any) {
    console.error('[MF] GET /api/payouts/summary error', err);

    if (err instanceof Error && err.message === 'Trainer not authenticated') {
      return withCors({ error: 'Unauthorized' }, 401);
    }

    return withCors(
      { error: 'Erreur serveur lors du chargement du solde.' },
      500,
    );
  }
}
