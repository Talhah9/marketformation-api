// app/api/payouts/summary/route.ts
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { authTrainer } from '@/lib/authTrainer';

export async function GET(req: NextRequest) {
  try {
    const trainer = await authTrainer(req);
    if (!trainer) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    return NextResponse.json({
      ok: true,
      trainerId: trainer.id,
      summary: {
        totalEarned: 0,
        pending: 0,
        available: 0,
        lastPayout: null,
      }
    });
  } catch (err) {
    console.error('[MF] payouts/summary error', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
