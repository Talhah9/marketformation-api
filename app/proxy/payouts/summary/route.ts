// app/proxy/payouts/summary/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyShopifyAppProxy } from '@/app/api/_lib/proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function maskIban(iban: string | null | undefined): string | null {
  if (!iban) return null;
  const clean = iban.replace(/\s+/g, '');
  if (clean.length <= 8) return '•••• ' + clean.slice(-4);
  return clean.slice(0, 4) + ' •• •• •• ' + clean.slice(-4);
}

export async function GET(req: NextRequest) {
  try {
    // ✅ 1) Vérif signature App Proxy
    if (!verifyShopifyAppProxy(req)) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }

    // ✅ 2) Récupère l’id customer Shopify depuis l’App Proxy
    const url = new URL(req.url);
    const trainerId =
      url.searchParams.get('logged_in_customer_id') ||
      url.searchParams.get('customer_id') ||
      '';

    if (!trainerId) {
      return NextResponse.json({ ok: false, error: 'missing_trainer_id' }, { status: 401 });
    }

    // (Optionnel) email si tu l’envoies depuis le front (pas obligatoire)
    const email = (url.searchParams.get('email') || '').trim() || null;

    // 1) S’assure qu’un TrainerBanking existe
    const banking = await prisma.trainerBanking.upsert({
      where: { trainerId },
      update: { email: email ?? undefined },
      create: { trainerId, email },
    });

    // 2) Résumé
    const summary = await prisma.payoutsSummary.upsert({
      where: { trainerId },
      update: {},
      create: {
        trainerId,
        availableAmount: 0,
        pendingAmount: 0,
        currency: 'EUR',
      },
    });

    // 3) Historique
    const history = await prisma.payoutsHistory.findMany({
      where: { trainerId },
      orderBy: { date: 'desc' },
      take: 20,
    });

    const historyPayload = history.map((item) => ({
      id: item.id,
      type: item.type,
      status: item.status,
      amount: Number(item.amount),
      currency: item.currency,
      date: item.date.toISOString(),
      date_label: item.date.toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }),
      meta: item.meta ?? null,
    }));

    return NextResponse.json(
      {
        ok: true,
        currency: summary.currency,
        available: Number(summary.availableAmount),
        pending: Number(summary.pendingAmount),
        min_payout: 50,
        has_banking: !!banking.payoutIban,
        auto_payout: banking.autoPayout,
        banking: {
          payout_name: banking.payoutName,
          payout_country: banking.payoutCountry,
          payout_iban_masked: maskIban(banking.payoutIban),
          payout_bic: banking.payoutBic,
        },
        history: historyPayload,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('[MF] /proxy/payouts/summary GET error', err);
    return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
  }
}
