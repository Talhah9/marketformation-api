import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireTrainer } from '@/lib/authTrainer';

export async function POST(req: NextRequest) {
  try {
    const trainer = await requireTrainer(req);
    if (!trainer) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 });
    }

    const { payout_name, payout_country, payout_iban, payout_bic, auto_payout, partial } = body;

    if (!partial) {
      if (!payout_name || !payout_country || !payout_iban) {
        return NextResponse.json(
          { ok: false, error: 'Missing required fields' },
          { status: 400 }
        );
      }
    }

    const updated = await prisma.trainerBanking.upsert({
      where: { trainerId: trainer.id },
      update: {
        payoutName: payout_name ?? undefined,
        payoutCountry: payout_country ?? undefined,
        payoutIban: payout_iban ?? undefined,
        payoutBic: payout_bic ?? undefined,
        autoPayout: auto_payout ?? undefined,
      },
      create: {
        trainerId: trainer.id,
        payoutName: payout_name ?? null,
        payoutCountry: payout_country ?? null,
        payoutIban: payout_iban ?? null,
        payoutBic: payout_bic ?? null,
        autoPayout: auto_payout ?? false,
      },
    });

    return NextResponse.json({
      ok: true,
      banking: {
        name: updated.payoutName,
        country: updated.payoutCountry,
        iban: updated.payoutIban ? '****' + updated.payoutIban.slice(-4) : '',
        bic: updated.payoutBic,
        auto: updated.autoPayout,
      },
    });
  
  } catch (err) {
    console.error('BANKING ERROR', err);
    return NextResponse.json(
      { ok: false, error: 'Server error' },
      { status: 500 }
    );
  }
}
