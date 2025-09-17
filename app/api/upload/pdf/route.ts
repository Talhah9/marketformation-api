// app/api/upload/pdf/route.ts
// Upload PDF vers Vercel Blob (public). Réponse JSON avec CORS compatible Shopify.
// Aucune dépendance externe pour le CORS : tout est géré ici.

import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PDF_MIME = 'application/pdf';
const MAX_PDF_SIZE = 50 * 1024 * 1024; // 50 MB
const ENV_ORIGIN = process.env.CORS_ORIGIN?.trim();

/* ---------- Utils CORS ---------- */

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  // 1) Origin explicitement configurée
  if (ENV_ORIGIN && origin === ENV_ORIGIN) return true;
  // 2) Tous les sous-domaines Shopify si pas d'ENV précise
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
    // Par défaut, on expose au domaine configuré (prévient le blocage navigateur)
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
  // Répond aux pré-vols
  return corsResponse(req, null, { status: 204 });
}

/* ---------- Helpers ---------- */

function sanitizeName(name: string) {
  return (name || 'document.pdf')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '');
}

// Certains navigateurs envoient file.type = '' ou 'application/octet-stream'.
// On sniffe les 5 premiers octets pour vérifier "%PDF-".
async function isPdfByMagic(file: File): Promise<boolean> {
  try {
    const buf = await file.slice(0, 5).arrayBuffer();
    const sig = new TextDecoder().decode(buf);
    return sig === '%PDF-';
  } catch {
    return false;
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
    // Compat: certains fronts envoient 'file' ; le tien envoie 'pdf'
    const file = (form.get('pdf') || form.get('file')) as File | null;

    if (!file || !(file instanceof File)) {
      return corsResponse(req, { ok: false, error: 'missing_field_pdf' }, { status: 400 });
    }
    if (file.size > MAX_PDF_SIZE) {
      return corsResponse(
        req,
        { ok: false, error: 'file_too_large', max: MAX_PDF_SIZE },
        { status: 413 }
      );
    }

    // Vérif MIME ou signature
    const looksPdf =
      file.type === PDF_MIME ||
      file.type === 'application/octet-stream' ||
      file.type === '' ||
      (await isPdfByMagic(file));

    if (!looksPdf) {
      return corsResponse(
        req,
        { ok: false, error: 'invalid_mime', received: file.type || 'unknown', expected: PDF_MIME },
        { status: 415 }
      );
    }

    const key = `uploads/pdfs/${Date.now()}-${sanitizeName(file.name)}`;

    const uploaded = await put(key, file, {
      access: 'public',
      contentType: PDF_MIME, // force application/pdf
      addRandomSuffix: false,
      token, // important: force le token
    });

    return corsResponse(req, {
      ok: true,
      url: uploaded.url,
      pathname: uploaded.pathname,
      size: file.size,
      mime: PDF_MIME,
    });
  } catch (e: any) {
    console.error('upload/pdf error:', e);
    return corsResponse(req, { ok: false, error: e?.message || 'upload_failed' }, { status: 500 });
  }
}

/* ---------- (Optionnel) GET ping ---------- */
// Utile pour vérifier rapidement CORS/DNS depuis le navigateur.
export async function GET(req: Request) {
  return corsResponse(req, { ok: true, route: 'upload/pdf' });
}
