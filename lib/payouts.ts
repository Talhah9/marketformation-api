// lib/payouts.ts
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';

// S'assure qu'il existe une ligne PayoutsSummary pour ce formateur
export async function ensureSummaryRow(trainerId: string) {
  return prisma.payoutsSummary.upsert({
    where: { trainerId },
    create: {
      trainerId,
      availableAmount: new Prisma.Decimal(0),
      pendingAmount: new Prisma.Decimal(0),
    },
    update: {},
  });
}

// Créditer un formateur après une vente (utilisé dans le webhook Shopify)
export async function creditTrainerSale(
  trainerId: string,
  amount: number,
  currency = 'EUR',
  meta?: any
) {
  const dec = new Prisma.Decimal(amount);

  await ensureSummaryRow(trainerId);

  await prisma.$transaction([
    prisma.payoutsSummary.update({
      where: { trainerId },
      data: {
        availableAmount: { increment: dec },
      },
    }),
    prisma.payoutsHistory.create({
      data: {
        trainerId,
        type: 'sale',
        status: 'available',
        amount: dec,
        currency,
        meta,
      },
    }),
  ]);
}

// Créer une demande de retrait (déplace available -> pending)
export async function requestWithdrawal(
  trainerId: string,
  amount: number,
  currency = 'EUR',
  meta?: any
) {
  const dec = new Prisma.Decimal(amount);

  await ensureSummaryRow(trainerId);

  await prisma.$transaction([
    prisma.payoutsSummary.update({
      where: { trainerId },
      data: {
        availableAmount: { decrement: dec },
        pendingAmount: { increment: dec },
      },
    }),
    prisma.payoutsHistory.create({
      data: {
        trainerId,
        type: 'withdraw',
        status: 'requested',
        amount: dec,
        currency,
        meta,
      },
    }),
  ]);
}

// Marquer un retrait comme payé (pour ton back-office admin)
export async function markWithdrawalPaid(historyId: string) {
  const history = await prisma.payoutsHistory.findUnique({
    where: { id: historyId },
  });

  if (!history) {
    throw new Error('Payout history not found');
  }
  if (history.type !== 'withdraw' || history.status !== 'requested') {
    throw new Error('Payout not in requested state');
  }

  await prisma.$transaction([
    prisma.payoutsSummary.update({
      where: { trainerId: history.trainerId },
      data: {
        pendingAmount: { decrement: history.amount },
      },
    }),
    prisma.payoutsHistory.update({
      where: { id: history.id },
      data: {
        status: 'paid',
        type: 'paid',
        date: new Date(),
      },
    }),
  ]);
}
