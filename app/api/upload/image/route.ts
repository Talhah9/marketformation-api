// Upload image → Shopify Files CDN (REST)
// Prérequis env: SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_API_ACCESS_TOKEN
import { put } from '@vercel/blob';
import { handleOptions, jsonWithCors } from '@/app/api/_lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB, ajuste si besoin

function sanitizeName(name: string) {
  // enlève les espaces/accents/caractères bizarres
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '');
}

export async function OPTIONS(req: Request) {
  return handleOptions(req);
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get('image');

    if (!file || !(file instanceof File)) {
      return jsonWithCors(req, { ok: false, error: 'missing_field_image' }, { status: 400 });
    }

    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      return jsonWithCors(
        req,
        { ok: false, error: 'invalid_mime', received: file.type, allowed: ALLOWED_IMAGE_TYPES },
        { status: 415 }
      );
    }

    if (file.size > MAX_IMAGE_SIZE) {
      return jsonWithCors(req, { ok: false, error: 'file_too_large', max: MAX_IMAGE_SIZE }, { status: 413 });
    }

    const baseName = sanitizeName(file.name || 'image');
    const key = `uploads/images/${Date.now()}-${baseName}`;
    const arrayBuffer = await file.arrayBuffer();

    const uploaded = await put(key, arrayBuffer, {
      access: 'public',
      contentType: file.type,
      addRandomSuffix: false,
    });

    return jsonWithCors(req, { ok: true, url: uploaded.url, pathname: uploaded.pathname });
  } catch (e: any) {
    return jsonWithCors(req, { ok: false, error: e?.message || 'upload_failed' }, { status: 500 });
  }
}

