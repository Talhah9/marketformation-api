// app/api/trainer/banking/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getCurrentTrainer } from '@/lib/authTrainer';

type BankingPayload = {
  payoutName: string;
  payoutCountry: string;
  payoutIban: string;
  payoutBic?: string;
};

function maskIban(iban: string) {
  const clean = iban.replace(/\s+/g, '');
  if (clean.length <= 8) return clean;
  return clean.slice(0, 4) + '••••••' + clean.slice(-4);
}

export async function POST(req: NextRequest) {
  try {
    const { trainerId, email } = await getCurrentTrainer(req);
    const body = (await req.json()) as BankingPayload;

    if (!body.payoutName || !body.payoutCountry || !body.payoutIban) {
      return NextResponse.json(
        { error: 'Champs obligatoires manquants.' },
        { status: 400 },
      );
    }

    const iban = body.payoutIban.trim();
    const bic = body.payoutBic?.trim() || null;

    const banking = await prisma.trainerBanking.upsert({
      where: { trainerId },
      create: {
        trainerId,
        email: email || null,
        payoutName: body.payoutName,
        payoutCountry: body.payoutCountry,
        payoutIban: iban, // à chiffrer plus tard si tu veux
        payoutBic: bic,
      },
      update: {
        payoutName: body.payoutName,
        payoutCountry: body.payoutCountry,
        payoutIban: iban,
        payoutBic: bic,
      },
    });

    return NextResponse.json({
      ok: true,
      banking: {
        payoutName: banking.payoutName,
        payoutCountry: banking.payoutCountry,
        payoutIbanMasked: banking.payoutIban ? maskIban(banking.payoutIban) : null,
        payoutBic: banking.payoutBic,
        autoPayout: banking.autoPayout,
      },
    });
  } catch (err: any) {
    console.error('[MF] POST /api/trainer/banking error', err);
    if (err instanceof Error && err.message === 'Trainer not authenticated') {
      return NextResponse.json(
        { error: 'Non authentifié.' },
        { status: 401 },
      );
    }
    return NextResponse.json(
      { error: 'Erreur serveur lors de la sauvegarde des informations bancaires.' },
      { status: 500 },
    );
  }
}
