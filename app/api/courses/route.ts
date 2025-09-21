import { NextResponse } from 'next/server';
import { withCORS, corsOptions } from '@/app/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STORE = process.env.SHOPIFY_STORE_DOMAIN!;
const ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN!;

async function shopify(path: string, init: RequestInit = {}) {
  const url = `https://${STORE}/admin/api/2024-07${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': ADMIN_TOKEN,
      ...(init.headers || {})
    }
  });
  const txt = await res.text();
  let json:any = {}; try { json = txt ? JSON.parse(txt) : {}; } catch {}
  if (!res.ok) throw new Error(json?.errors ? JSON.stringify(json.errors) : `Shopify ${res.status}`);
  return json;
}

export async function OPTIONS(req: Request) { return corsOptions(req); }

// GET /api/courses?email=...
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const email = url.searchParams.get('email') || '';
    // on utilise vendor=email pour “segmenter” par formateur
    const { products } = await shopify(`/products.json?vendor=${encodeURIComponent(email)}&limit=50&order=created_at+desc`);
    const items = (products||[]).map((p:any)=>({
      id: p.id,
      title: p.title,
      coverUrl: p.image?.src || '',
      published: !!p.published_at,
      createdAt: p.created_at
    }));
    return withCORS(req, NextResponse.json({ ok:true, items }, { status:200 }));
  } catch (e:any) {
    console.error('courses GET error', e);
    return withCORS(req, NextResponse.json({ ok:false, error: e.message || 'Shopify error' }, { status:500 }));
  }
}

// POST create product
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { email, title, description, imageUrl, pdfUrl, collectionHandle } = body || {};
    if (!email || !title || !description || !imageUrl || !pdfUrl) {
      return withCORS(req, NextResponse.json({ ok:false, error:'Missing fields' }, { status:400 }));
    }

    // 1) create product
    const productPayload = {
      product: {
        title,
        body_html: `<p>${description}</p>`,
        vendor: email,
        status: "active",
        images: imageUrl ? [{ src: imageUrl }] : [],
        metafields: [
          { namespace: 'mfapp', key: 'pdf_url', type: 'single_line_text_field', value: pdfUrl },
          { namespace: 'mfapp', key: 'trainer_email', type: 'single_line_text_field', value: email }
        ]
      }
    };
    const { product } = await shopify('/products.json', { method:'POST', body: JSON.stringify(productPayload) });

    // 2) attach to collection if handle provided
    if (collectionHandle) {
      // fetch smart collection id by handle, then add collect
      try {
        const { custom_collections } = await shopify(`/custom_collections.json?handle=${encodeURIComponent(collectionHandle)}`);
        const col = (custom_collections||[])[0];
        if (col?.id) {
          await shopify('/collects.json', {
            method:'POST',
            body: JSON.stringify({ collect: { product_id: product.id, collection_id: col.id } })
          });
        }
      } catch {}
    }

    return withCORS(req, NextResponse.json({ ok:true, id: product.id }, { status:200 }));
  } catch (e:any) {
    console.error('courses POST error', e);
    return withCORS(req, NextResponse.json({ ok:false, error: e.message || 'Shopify error' }, { status:500 }));
  }
}
