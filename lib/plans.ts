// lib/plans.ts
export const PLAN_CONFIG = {
  starter: { name: "Starter", monthlyLimit: 1 },
  creator: { name: "Creator", monthlyLimit: 3 },
} as const;

export type PlanKey = keyof typeof PLAN_CONFIG;

export const priceIdToPlanKey = (priceId: string | undefined | null): PlanKey | null => {
  if (!priceId) return null;
  const map: Record<string, PlanKey> = {
    [process.env.STRIPE_PRICE_STARTER!]: "starter",
    [process.env.STRIPE_PRICE_CREATOR!]: "creator",
  };
  return map[priceId] ?? null;
};
