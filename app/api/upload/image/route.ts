// Upload image → Shopify Files CDN (REST)
// Prérequis env: SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_API_ACCESS_TOKEN
import { put } from '@vercel/blob';
import { handleOptions, jsonWithCors } from '@/app/api/_lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB

function sanitizeName(name: string) {
  return (name || 'image')
    .toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9._-]/g, '');
}

export async function OPTIONS(req: Request) { return handleOptions(req); }

export async function POST(req: Request) {
  try {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      return jsonWithCors(req, { ok:false, error:'blob_token_missing' }, { status:500 });
    }

    const form = await req.formData();
    const file = form.get('image');

    if (!file || !(file instanceof File)) {
      return jsonWithCors(req, { ok:false, error:'missing_field_image' }, { status:400 });
    }
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      return jsonWithCors(req, { ok:false, error:'invalid_mime', received:file.type, allowed:ALLOWED_IMAGE_TYPES }, { status:415 });
    }
    if (file.size > MAX_IMAGE_SIZE) {
      return jsonWithCors(req, { ok:false, error:'file_too_large', max:MAX_IMAGE_SIZE }, { status:413 });
    }

    const key = `uploads/images/${Date.now()}-${sanitizeName(file.name)}`;

    const uploaded = await put(key, file, {
      access: 'public',
      contentType: file.type,
      addRandomSuffix: false,
      token,                        // ← IMPORTANT
    });

    return jsonWithCors(req, { ok:true, url: uploaded.url, pathname: uploaded.pathname });
  } catch (e: any) {
    console.error('upload/image error:', e);
    return jsonWithCors(req, { ok:false, error: e?.message || 'upload_failed' }, { status:500 });
  }
}

