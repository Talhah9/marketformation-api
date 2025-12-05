// app/api/payouts/summary/auto/route.ts
import { NextResponse } from 'next/server';

/**
 * Ancienne route interne d’auto-mise à jour des résumés de paiements.
 * Elle n’est plus utilisée par le front. On la garde uniquement pour
 * éviter les 404 si jamais quelque chose tente encore de l’appeler.
 */
export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: 'AUTO_PAYOUT_SUMMARY_DISABLED',
      message: 'Cette route est désactivée dans la nouvelle version de MarketFormation.',
    },
    { status: 410 } // Gone
  );
}
