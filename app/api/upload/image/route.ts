// app/api/upload/image/route.ts
import { put } from '@vercel/blob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

// CORS (copié-collé du PDF)
const RAW = (process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || '').trim();
const ALLOWED = RAW ? RAW.split(',').map(s => s.trim()).filter(Boolean) : [];
function allowOrigin(req: Request) {
  const origin = req.headers.get('origin') || '';
  if (!ALLOWED.length) {
    try { const u = new URL(origin); if (u.hostname.endsWith('.myshopify.com')) return origin; } catch {}
    return '*';
  }
  return ALLOWED.includes(origin) ? origin : (ALLOWED[0] || '*');
}
function withCORS(req: Request, res: Response) {
  res.headers.set('Access-Control-Allow-Origin', allowOrigin(req));
  res.headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', req.headers.get('access-control-request-headers') || 'Content-Type, Accept');
  res.headers.set('Access-Control-Max-Age', '86400');
  res.headers.set('Vary', 'Origin, Access-Control-Request-Headers');
  res.headers.set('Cache-Control', 'no-store');
  res.headers.set('x-route', 'upload-image');
  return res;
}
function json(req: Request, data: any, status = 200) {
  return withCORS(req, new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }));
}

export async function OPTIONS(req: Request) { return withCORS(req, new Response(null, { status: 204 })); }
export async function GET(req: Request) { return json(req, { ok: true, endpoint: 'upload/image', method: 'GET' }); }

export async function POST(req: Request) {
  try {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) return json(req, { ok: false, error: 'blob_token_missing' }, 500);

    const form = await req.formData().catch(() => null);
    const file = form?.get('image');
    if (!file || !(file instanceof File)) return json(req, { ok: false, error: 'missing_field_image' }, 400);
    if (!ALLOWED_TYPES.includes((file as File).type as any)) {
      return json(req, { ok: false, error: 'invalid_mime', received: (file as File).type, allowed: ALLOWED_TYPES }, 415);
    }
    if ((file as File).size > MAX_IMAGE_SIZE) {
      return json(req, { ok: false, error: 'file_too_large', max: MAX_IMAGE_SIZE }, 413);
    }

    const safe = (name: string) => (name || 'image').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9._-]/g, '');
    const key = `uploads/images/${Date.now()}-${safe((file as File).name)}`;

    const up = await put(key, file, {
      access: 'public',
      contentType: (file as File).type,
      addRandomSuffix: false,
      token,
    });

    return json(req, { ok: true, url: up.url, pathname: up.pathname, size: (file as File).size, mime: (file as File).type });
  } catch (e: any) {
    console.error('upload/image error:', e);
    return json(req, { ok: false, error: e?.message || 'upload_failed' }, 500);
  }
}
