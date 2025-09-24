// app/api/profile/route.ts
import { handleOptions, jsonWithCors } from '@/app/api/_lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function shopifyAdmin(path: string, init?: RequestInit & { json?: any }) {
  const base = `https://${process.env.SHOP_DOMAIN}/admin/api/2024-07`;
  const headers: Record<string, string> = {
    'X-Shopify-Access-Token': process.env.SHOP_ADMIN_TOKEN || process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN || process.env.ADMIN_TOKEN || '',
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
  const res = await fetch(base + path, {
    method: init?.method || (init?.json ? 'POST' : 'GET'),
    headers,
    body: init?.json ? JSON.stringify(init.json) : undefined,
    cache: 'no-store',
  });
  const text = await res.text();
  let json: any = {};
  try { json = text ? JSON.parse(text) : {}; } catch {}
  return { ok: res.ok, status: res.status, json, text };
}

export async function OPTIONS(req: Request) {
  return handleOptions(req);
}

export async function GET(req: Request) {
  // … récupère le profil public (metafields), garde ta logique existante
  return jsonWithCors(req, { ok: true, profile: {} });
}

export async function POST(req: Request) {
  // … enregistre le profil public (bio, avatar_url, expertise_url)
  return jsonWithCors(req, { ok: true, profile: {} });
}
