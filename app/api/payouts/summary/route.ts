// app/api/payouts/summary/route.ts
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentTrainer } from '@/lib/authTrainer';

// CORS fixe pour ton domaine Shopify
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://marketformation.fr',
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

// Préflight
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function GET(req: NextRequest) {
  try {
    const { trainerId } = await getCurrentTrainer(req);

    // Stub pour tester le front + CORS
    return withCors({
      ok: true,
      trainerId,
      summary: {
        totalEarned: 0,
        pending: 0,
        available: 0,
        lastPayout: null,
      },
    });
  } catch (err: any) {
    console.error('[MF] payouts/summary error', err);

    if (err instanceof Error && err.message === 'Trainer not authenticated') {
      return withCors({ error: 'Unauthorized' }, 401);
    }

    return withCors(
      { error: 'Erreur serveur lors du chargement du solde.' },
      500,
    );
  }
}
