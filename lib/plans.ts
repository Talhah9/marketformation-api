// lib/plans.ts
export const PLAN_CONFIG = {
  starter: { priceEnv: 'STRIPE_PRICE_STARTER', monthlyLimit: 3 },
  pro:      { priceEnv: 'STRIPE_PRICE_PRO',      monthlyLimit: Infinity },
  business: { priceEnv: 'STRIPE_PRICE_BUSINESS', monthlyLimit: Infinity },
};

export const priceIdToPlanKey = (priceId: string) => {
  const map = {
    [process.env.STRIPE_PRICE_STARTER!]: 'starter',
    [process.env.STRIPE_PRICE_PRO!]: 'pro',
    [process.env.STRIPE_PRICE_BUSINESS!]: 'business',
  } as Record<string,string>;
  return map[priceId] ?? null;
};
