// app/api/courses/[id]/edit/route.ts
import { handleOptions, jsonWithCors } from '@/app/api/_lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// =============== Helpers Shopify ===============
function getAdminToken() {
  return (
    process.env.SHOP_ADMIN_TOKEN ||
    process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN ||
    process.env.ADMIN_TOKEN ||
    ''
  );
}

async function shopifyFetch(
  path: string,
  init?: RequestInit & { json?: any }
) {
  const domain = process.env.SHOP_DOMAIN;
  if (!domain) throw new Error('Missing SHOP_DOMAIN');

  const base = `https://${domain}/admin/api/2024-07`;
  const headers: Record<string, string> = {
    'X-Shopify-Access-Token': getAdminToken(),
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  const res = await fetch(base + path, {
    method: init?.method || (init?.json ? 'POST' : 'GET'),
    headers,
    body: init?.json ? JSON.stringify(init.json) : undefined,
    cache: 'no-store',
  });

  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}

  return { ok: res.ok, status: res.status, json, text };
}

// =============== CORS OPTIONS ===============
export async function OPTIONS(req: Request) {
  return handleOptions(req);
}

// =============== POST /api/courses/:id/edit ===============
export async function POST(
  req: Request,
  ctx: { params: { id: string } }
) {
  const id = ctx.params.id;
  if (!id) {
    return jsonWithCors(
      req,
      { ok: false, error: 'missing_id' },
      { status: 400 }
    );
  }

  if (!process.env.SHOP_DOMAIN || !getAdminToken()) {
    return jsonWithCors(
      req,
      { ok: false, error: 'missing_env' },
      { status: 500 }
    );
  }

  try {
    const body = await req.json().catch(() => ({} as any));

    const {
      title,
      description,
      imageUrl,
      status, // 'active' | 'draft' optionnel
    } = body || {};

    const product: any = { id: Number(id) };

    if (title && typeof title === 'string') {
      product.title = title;
    }

    if (description && typeof description === 'string') {
      product.body_html = `<p>${description}</p>`;
    }

    if (imageUrl && typeof imageUrl === 'string') {
      product.images = [{ src: imageUrl }];
    }

    if (status === 'active' || status === 'draft') {
      product.status = status;
    }

    if (
      !product.title &&
      !product.body_html &&
      !product.images &&
      !product.status
    ) {
      return jsonWithCors(
        req,
        {
          ok: false,
          error: 'nothing_to_update',
        },
        { status: 400 }
      );
    }

    const updateRes = await shopifyFetch(`/products/${id}.json`, {
      method: 'PUT',
      json: { product },
    });

    if (!updateRes.ok) {
      return jsonWithCors(
        req,
        {
          ok: false,
          error: `Shopify ${updateRes.status}`,
          detail: updateRes.text,
        },
        { status: updateRes.status }
      );
    }

    return jsonWithCors(req, {
      ok: true,
      id,
      product: updateRes.json?.product || null,
    });
  } catch (e: any) {
    return jsonWithCors(
      req,
      { ok: false, error: e?.message || 'edit_failed' },
      { status: 500 }
    );
  }
}
