// app/lib/env.ts
function req(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing env: ${name}`);
  return v.trim();
}
function opt(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

export const ENV = {
  SHOP_DOMAIN: opt('SHOP_DOMAIN') || req('SHOPIFY_STORE_DOMAIN'), // fallback temporaire
  // ... le reste
};
