// lib/gating.ts
import { NextResponse } from "next/server";
import { PLAN_CONFIG } from "./plans";
import { getMonthlyCount, bumpMonthlyCount } from "./usage";

export type PlanKey = keyof typeof PLAN_CONFIG;

function yyyymm(d = new Date()) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getFullYear()}${m}`;
}

export async function assertCanPublish(
  shopifyCustomerId: string,
  planKey: PlanKey,
  opts?: { isAdmin?: boolean }
): Promise<{ allowed: true; used: number; limit: number }> {
  // ✅ ADMIN BYPASS
  if (opts?.isAdmin) {
    return { allowed: true, used: 0, limit: Infinity };
  }

  const cfg = PLAN_CONFIG[planKey];
  const limit = cfg.monthlyLimit;

  // illimité (Infinity)
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

  await bumpMonthlyCount(shopifyCustomerId, period);
  return { allowed: true, used: used + 1, limit };
}
