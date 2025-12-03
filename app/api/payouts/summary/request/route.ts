// app/api/payouts/request/route.ts
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentTrainer } from '@/lib/authTrainer';

const MIN_PAYOUT = 50; // Montant minimum de retrait en EUR

export async function POST(req: NextRequest) {
  try {
    const { trainerId } = await getCurrentTrainer(req);

    // Import dynamique pour éviter les soucis au build
    const [{ prisma }, { ensureSummaryRow, requestWithdrawal }] = await Promise.all([
      import('@/lib/db'),
      import('@/lib/payouts'),
    ]);

    // Infos bancaires obligatoires
    const banking = await prisma.trainerBanking.findUnique({ where: { trainerId } });

    if (
      !banking ||
      !banking.payoutIban ||
      !banking.payoutName ||
      !banking.payoutCountry
    ) {
      return NextResponse.json(
        { error: 'Veuillez renseigner vos informations bancaires avant de demander un retrait.' },
        { status: 400 },
      );
    }

    // Résumé de solde
    const summaryRaw = await prisma.payoutsSummary.findUnique({ where: { trainerId } });
    const summary = summaryRaw ?? (await ensureSummaryRow(trainerId));

    const available = summary.availableAmount.toNumber();
    const currency = summary.currency || 'EUR';

    if (available < MIN_PAYOUT) {
      return NextResponse.json(
        { error: `Le retrait est possible à partir de ${MIN_PAYOUT} €.` },
        { status: 400 },
      );
    }

    // On demande le retrait de TOUT le solde disponible
    await requestWithdrawal(trainerId, available, currency, {
      reason: 'manual_request',
    });

    return NextResponse.json({
      ok: true,
      requestedAmount: available,
      currency,
    });
  } catch (err: any) {
    console.error('[MF] POST /api/payouts/request error', err);
    if (err instanceof Error && err.message === 'Trainer not authenticated') {
      return NextResponse.json(
        { error: 'Non authentifié.' },
        { status: 401 },
      );
    }
    return NextResponse.json(
      { error: 'Erreur serveur lors de la demande de retrait.' },
      { status: 500 },
    );
  }
}
