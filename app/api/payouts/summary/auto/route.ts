// app/api/payouts/auto/route.ts
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentTrainer } from '@/lib/authTrainer';

type AutoPayload = {
  autoPayout: boolean;
};

export async function POST(req: NextRequest) {
  try {
    const { trainerId, email } = await getCurrentTrainer(req);

    const body = (await req.json()) as AutoPayload;
    const autoPayout = body.autoPayout ?? false;

    // Import dynamique pour éviter les soucis au build
    const { prisma } = await import('@/lib/db');

    const banking = await prisma.trainerBanking.upsert({
      where: { trainerId },
      create: {
        trainerId,
        email: email || null,
        autoPayout,
      },
      update: {
        autoPayout,
      },
    });

    return NextResponse.json({
      ok: true,
      autoPayout: banking.autoPayout,
    });
  } catch (err: any) {
    console.error('[MF] POST /api/payouts/auto error', err);
    if (err instanceof Error && err.message === 'Trainer not authenticated') {
      return NextResponse.json(
        { error: 'Non authentifié.' },
        { status: 401 },
      );
    }
    return NextResponse.json(
      { error: 'Erreur serveur lors de la mise à jour du virement automatique.' },
      { status: 500 },
    );
  }
}
