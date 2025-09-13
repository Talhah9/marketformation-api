// lib/plans.ts
export const PLAN_CONFIG = {
  starter:  { name: 'Starter',  monthlyLimit: 3 },
  pro:      { name: 'Pro',      monthlyLimit: Infinity },
  business: { name: 'Business', monthlyLimit: Infinity },
} as const;

export type PlanKey = keyof typeof PLAN_CONFIG;

export const priceIdToPlanKey = (priceId: string | undefined | null): PlanKey | null => {
  if (!priceId) return null;
  const map: Record<string, PlanKey> = {
    [process.env.STRIPE_PRICE_STARTER!]: 'starter',
    [process.env.STRIPE_PRICE_PRO!]: 'pro',
    [process.env.STRIPE_PRICE_BUSINESS!]: 'business',
  };
  return map[priceId] ?? null;
};
