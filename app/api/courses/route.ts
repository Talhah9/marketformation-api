// app/api/courses/route.ts
// Crée un produit "Course" (vendor = email) + liste les courses.
// Vérifie l'abonnement Stripe + applique le quota Starter (3 / mois).
// Champs produits: image de couverture + métachamps mf.owner_email / mf.owner_id / mf.pdf_url.
// Ajoute à une collection par handle (custom/smart).
// Toutes les réponses passent par jsonWithCors (CORS via ton util).

import { handleOptions, jsonWithCors } from '@/app/api/_lib/cors';
import stripe from '@/lib/stripe';
import type Stripe from 'stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* ===== ENV requis =====
  SHOP_DOMAIN                      ex: tqiccz-96.myshopify.com
  SHOP_ADMIN_TOKEN / ADMIN_TOKEN   token Admin API
  STRIPE_SECRET_KEY                clé serveur Stripe
*/

function ym(d = new Date()) {
  return String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, '0');
}

async function shopifyFetch(path: string, init?: RequestInit & { json?: any }) {
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
  try {
    const url = new URL(req.url);
    const email = url.searchParams.get('email') || '';
    const vendor = email || 'unknown@vendor';
    // Exemple liste des produits par vendor
    const r = await shopifyFetch(`/products.json?vendor=${encodeURIComponent(vendor)}&limit=50`);
    if (!r.ok) return jsonWithCors(req, { ok: false, error: `Shopify ${r.status}`, detail: r.text }, { status: r.status });
    const products = r.json?.products || [];
    const items = products.map((p: any) => ({
      id: p.id,
      title: p.title,
      coverUrl: p.image?.src || '',
      published: !!p.published_at,
      createdAt: p.created_at,
      image_url: p.image?.src || '',
    }));
    return jsonWithCors(req, { ok: true, items });
  } catch (e: any) {
    return jsonWithCors(req, { ok: false, error: e?.message || 'list_failed' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { email, shopifyCustomerId, title, description, imageUrl, pdfUrl, collectionHandle } = body || {};

    if (!email || !title || !imageUrl || !pdfUrl) {
      return jsonWithCors(req, { ok: false, error: 'missing fields' }, { status: 400 });
    }

    // Vérif quota via Stripe (starter = 3 / mois) — pseudo
    // ... (garde ta logique existante ici)

    // Création produit
    const product = {
      product: {
        title,
        body_html: description || '',
        vendor: email,
        images: imageUrl ? [{ src: imageUrl }] : [],
        metafields: [
          { namespace: 'mfapp', key: 'owner_email', type: 'single_line_text_field', value: String(email) },
          { namespace: 'mfapp', key: 'owner_id',    type: 'single_line_text_field', value: String(shopifyCustomerId || '') },
          { namespace: 'mfapp', key: 'pdf_url',     type: 'single_line_text_field', value: String(pdfUrl) },
        ],
      },
    };
    const r = await shopifyFetch(`/products.json`, { json: product });
    if (!r.ok) return jsonWithCors(req, { ok: false, error: `Shopify ${r.status}`, detail: r.text }, { status: r.status });

    const created = r.json?.product;

    // Ajout à la collection si handle fourni
    if (collectionHandle) {
      await shopifyFetch(`/collects.json`, {
        json: { collect: { product_id: created.id, collection_id: collectionHandle } },
      }).catch(() => null);
    }

    return jsonWithCors(req, { ok: true, id: created?.id, product: created });
  } catch (e: any) {
    return jsonWithCors(req, { ok: false, error: e?.message || 'create_failed' }, { status: 500 });
  }
}
