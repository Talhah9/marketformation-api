// lib/usage.ts
export function usagePing() {
  return {
    shopDomain: process.env.SHOP_DOMAIN,
    cors: process.env.CORS_ORIGINS || '',
  };
}
