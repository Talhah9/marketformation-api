// lib/gating.ts
// Gating publication selon l’abonnement (Starter = 3/mois, Pro/Business = illimité)

import { NextResponse } from 'next/server';
import { PLAN_CONFIG } from './plans';
import { getMonthlyCount, bumpMonthlyCount } from './usage';

export type PlanKey = keyof typeof PLAN_CONFIG;

function yyyymm(d = new Date()) {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}${m}`;
}

/**
 * Vérifie le droit de publier et incrémente le compteur mensuel si OK.
 * - Starter : limite mensuelle (ex: 3)
 * - Pro/Business : illimité
 * En cas de dépassement, lève une réponse 402.
 */
export async function assertCanPublish(
  shopifyCustomerId: string,
  planKey: PlanKey
): Promise<{ allowed: true; used: number; limit: number }> {
  const cfg = PLAN_CONFIG[planKey];
  const limit = cfg.monthlyLimit;

  // Illimité (Pro/Business)
  if (!isFinite(limit)) {
    return { allowed: true, used: 0, limit: Infinity };
  }

  const period = yyyymm();
  const used = (await getMonthlyCount(shopifyCustomerId, period)) ?? 0;

  if (used >= limit) {
    throw NextResponse.json(
      { error: `Quota atteint : ${limit} formations / mois (plan ${cfg?.name ?? planKey}).` },
      { status: 402 }
    );
  }

  // Réserver un slot de publication (incrément immédiat)
  await bumpMonthlyCount(shopifyCustomerId, period);

  return { allowed: true, used: used + 1, limit };
}
