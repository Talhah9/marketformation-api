// app/api/payouts/summary/request/route.ts
import { NextResponse } from 'next/server';

/**
 * Ancienne route de demande de retrait.
 * Le front utilise maintenant /api/payouts/request.
 */
export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: 'DEPRECATED_ENDPOINT',
      message: 'Merci d’utiliser /api/payouts/request pour les demandes de retrait.',
    },
    { status: 410 }
  );
}
