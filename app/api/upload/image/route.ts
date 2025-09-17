// app/api/upload/image/route.ts
// Upload image vers Vercel Blob (public) — CORS compatible Shopify + vérif signature.
// Front shape conservé: { ok: true, url }

import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB
const ENV_ORIGIN = process.env.CORS_ORIGIN?.trim();

/* ---------- CORS helpers ---------- */
function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (ENV_ORIGIN && origin === ENV_ORIGIN) return true;
  try {
    const u = new URL(origin);
    return u.hostname.endsWith('.myshopify.com');
  } catch {
    return false;
  }
}

function corsResponse(req: Request, body: any, init?: ResponseInit) {
  const res = NextResponse.json(body, {
    status: init?.status ?? 200,
    headers: init?.headers,
  });
  const origin = req.headers.get('origin');
  if (isAllowedOrigin(origin)) {
    res.headers.set('Access-Control-Allow-Origin', origin!);
  } else if (ENV_ORIGIN) {
    res.headers.set('Access-Control-Allow-Origin', ENV_ORIGIN);
  }
  res.headers.set('Vary', 'Origin');
  res.headers.set('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.headers.set('Access-Control-Max-Age', '86400');
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

export async function OPTIONS(req: Request) {
  return corsResponse(req, null, { status: 204 });
}

/* ---------- Utils ---------- */
function sanitizeName(name: string) {
  return (name || 'image')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '');
}

// Détection PNG/JPEG/WEBP par magic bytes pour gérer type vide/octet-stream
async function sniffImageMime(file: File): Promise<'image/png' | 'image/jpeg' | 'image/webp' | null> {
  try {
    const buf = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    const isPNG =
      buf.length >= 8 &&
      buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
      buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a;
    if (isPNG) return 'image/png';

    // JPEG: FF D8 FF
    const isJPG = buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    if (isJPG) return 'image/jpeg';

    // WEBP: "RIFF"...."WEBP"
    const isRIFF =
      buf.length >= 12 &&
      buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && // RIFF
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50; // WEBP
    if (isRIFF) return 'image/webp';

    return null;
  } catch {
    return null;
  }
}

/* ---------- POST ---------- */
export async function POST(req: Request) {
  try {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      return corsResponse(req, { ok: false, error: 'blob_token_missing' }, { status: 500 });
    }

    const form = await req.formData();
    // Compat: certains fronts envoient 'file' au lieu de 'image'
    const file = (form.get('image') || form.get('file')) as File | null;

    if (!file || !(file instanceof File)) {
      return corsResponse(req, { ok: false, error: 'missing_field_image' }, { status: 400 });
    }
    if (file.size > MAX_IMAGE_SIZE) {
      return corsResponse(
        req,
        { ok: false, error: 'file_too_large', max: MAX_IMAGE_SIZE },
        { status: 413 }
      );
    }

    // MIME fiable: type accepté OU type vide/octet-stream mais signature valide
    const declared = (file.type || '').toLowerCase();
    let mime: (typeof ALLOWED_IMAGE_TYPES)[number] | null =
      (ALLOWED_IMAGE_TYPES as readonly string[]).includes(declared) ? (declared as any) : null;

    if (!mime) {
      const sniffed = await sniffImageMime(file);
      if (sniffed) mime = sniffed;
    }
    if (!mime) {
      return corsResponse(
        req,
        { ok: false, error: 'invalid_mime', received: declared || 'unknown', allowed: ALLOWED_IMAGE_TYPES },
        { status: 415 }
      );
    }

    const key = `uploads/images/${Date.now()}-${sanitizeName(file.name)}`;
    const uploaded = await put(key, file, {
      access: 'public',
      contentType: mime, // force un type propre
      addRandomSuffix: false,
      token,
    });

    return corsResponse(req, {
      ok: true,
      url: uploaded.url,
      pathname: uploaded.pathname,
      size: file.size,
      mime,
    });
  } catch (e: any) {
    console.error('upload/image error:', e);
    return corsResponse(req, { ok: false, error: e?.message || 'upload_failed' }, { status: 500 });
  }
}

/* ---------- GET ping (debug CORS/DNS) ---------- */
export async function GET(req: Request) {
  return corsResponse(req, { ok: true, route: 'upload/image' });
}
