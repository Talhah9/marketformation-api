// app/api/upload/pdf/route.ts
import { put } from '@vercel/blob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PDF_MIME = 'application/pdf';
const MAX_PDF_SIZE = 50 * 1024 * 1024; // 50 MB

// --- CORS utils (autonomes) ---
const RAW = (process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || '').trim();
const ALLOWED = RAW ? RAW.split(',').map(s => s.trim()).filter(Boolean) : [];

function allowOrigin(req: Request) {
  const origin = req.headers.get('origin') || '';
  if (!ALLOWED.length) {
    try {
      const u = new URL(origin);
      if (u.hostname.endsWith('.myshopify.com')) return origin;
    } catch {}
    return '*';
  }
  return ALLOWED.includes(origin) ? origin : (ALLOWED[0] || '*');
}
function withCORS(req: Request, res: Response) {
  res.headers.set('Access-Control-Allow-Origin', allowOrigin(req));
  res.headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.headers.set(
    'Access-Control-Allow-Headers',
    req.headers.get('access-control-request-headers') || 'Content-Type, Accept'
  );
  res.headers.set('Access-Control-Max-Age', '86400');
  res.headers.set('Vary', 'Origin, Access-Control-Request-Headers');
  res.headers.set('Cache-Control', 'no-store');
  res.headers.set('x-route', 'upload-pdf');
  return res;
}
function json(req: Request, data: any, status = 200) {
  return withCORS(req, new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }));
}

// --- Préflight CORS ---
export async function OPTIONS(req: Request) {
  return withCORS(req, new Response(null, { status: 204 }));
}

// --- GET de ping/debug (ouvre l’URL dans le navigateur) ---
export async function GET(req: Request) {
  return json(req, { ok: true, endpoint: 'upload/pdf', method: 'GET' });
}

// --- POST upload ---
export async function POST(req: Request) {
  try {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) return json(req, { ok: false, error: 'blob_token_missing' }, 500);

    const form = await req.formData().catch(() => null);
    const file = form?.get('pdf');
    if (!file || !(file instanceof File)) {
      return json(req, { ok: false, error: 'missing_field_pdf' }, 400);
    }
    if (file.type !== PDF_MIME) {
      return json(req, { ok: false, error: 'invalid_mime', received: file.type, expected: PDF_MIME }, 415);
    }
    if (file.size > MAX_PDF_SIZE) {
      return json(req, { ok: false, error: 'file_too_large', max: MAX_PDF_SIZE }, 413);
    }

    const safe = (name: string) =>
      (name || 'document.pdf').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9._-]/g, '');
    const key = `uploads/pdfs/${Date.now()}-${safe((file as File).name)}`;

    const up = await put(key, file, {
      access: 'public',
      contentType: file.type,
      addRandomSuffix: false,
      token,
    });

    return json(req, { ok: true, url: up.url, pathname: up.pathname, size: file.size, mime: file.type });
  } catch (e: any) {
    console.error('upload/pdf error:', e);
    return json(req, { ok: false, error: e?.message || 'upload_failed' }, 500);
  }
}
