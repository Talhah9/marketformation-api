// app/proxy/payouts/summary/route.ts
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Vérifie la signature Shopify App Proxy.
 * Shopify appelle /apps/mf/... → ton backend reçoit /proxy/... avec ?signature=...
 */
function verifyShopifyAppProxy(req: NextRequest): boolean {
  const secret = process.env.APP_PROXY_SHARED_SECRET || '';
  if (!secret) return false;

  const url = new URL(req.url);
  const sig = url.searchParams.get('signature') || '';
  if (!sig) return false;

  // Recrée le message: concat key=value (sans signature), trié par key
  const pairs: Array<[string, string]> = [];
  url.searchParams.forEach((value, key) => {
    if (key === 'signature') return;
    pairs.push([key, value]);
  });
  pairs.sort((a, b) => a[0].localeCompare(b[0]));
  const message = pairs.map(([k, v]) => `${k}=${v}`).join('');

  const digest = crypto.createHmac('sha256', secret).update(message).digest('hex');

  const a = Buffer.from(digest, 'hex');
  const b = Buffer.from(sig, 'hex');
  if (a.length !== b.length) return false;

  // ✅ Fix TS Buffer vs ArrayBufferView
  return crypto.timingSafeEqual(new Uint8Array(a), new Uint8Array(b));
}

// Petit helper pour masquer l’IBAN côté front
function maskIban(iban: string | null | undefined): string | null {
  if (!iban) return null;
  const clean = iban.replace(/\s+/g, '');
  if (clean.length <= 8) return '•••• ' + clean.slice(-4);
  return clean.slice(0, 4) + ' •• •• •• ' + clean.slice(-4);
}

export async function GET(req: NextRequest) {
  try {
    // 1) Vérif signature App Proxy
    if (!verifyShopifyAppProxy(req)) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }

    // 2) Récup params (ton front ajoute email + shopifyCustomerId)
    const url = new URL(req.url);
    const email = (url.searchParams.get('email') || '').trim();
    const trainerId = (url.searchParams.get('shopifyCustomerId') || '').trim();

    if (!trainerId) {
      return NextResponse.json(
        { ok: false, error: 'missing_trainerId' },
        { status: 400 }
      );
    }

    // 3) On s’assure qu’un TrainerBanking existe
    const banking = await prisma.trainerBanking.upsert({
      where: { trainerId },
      update: { email: email || undefined },
      create: { trainerId, email: email || null },
    });

    // 4) Résumé payouts
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

    // 5) Historique (20 derniers)
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

    // ✅ compat front “graph + kpi”
    const available_cents = Number(summary.availableAmount || 0);
    const pending_cents = Number(summary.pendingAmount || 0);

    return NextResponse.json(
      {
        ok: true,

        // legacy / UI banking
        currency: summary.currency,
        available: available_cents,
        pending: pending_cents,
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

        // ✅ champs attendus par ton script profil (fallback si pas encore branché Stripe)
        available_cents,
        pending_cents,
        total_revenue_cents: 0,
        eta_text: '—',
        last_30_days_cents: new Array(30).fill(0),
      },
      { status: 200 }
    );
  } catch (err) {
    console.error('[MF] /proxy/payouts/summary GET error', err);
    return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
  }
}
