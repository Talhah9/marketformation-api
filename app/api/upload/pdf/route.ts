// app/api/upload/pdf/route.ts
import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';

const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || 'https://tqiccz-96.myshopify.com';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
};

function cors(json: any, status = 200) {
  const res = NextResponse.json(json, { status });
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.headers.set(k, v as string));
  return res;
}

export async function OPTIONS() {
  // Preflight
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...CORS_HEADERS,
      'Vary': 'Origin',
    },
  });
}

export const runtime = 'nodejs'; // important pour @vercel/blob

export async function POST(req: Request) {
  try {
    const origin = req.headers.get('origin') || '';
    if (origin !== ALLOWED_ORIGIN) {
      return cors({ error: 'Origin not allowed' }, 403);
    }

    const form = await req.formData();
    const file = form.get('pdf');

    if (!file || !(file instanceof File)) {
      return cors({ error: 'Missing file field "pdf"' }, 400);
    }

    // (Optionnel) vérifier le type
    const type = file.type || 'application/pdf';
    if (!type.includes('pdf')) {
      return cors({ error: 'Only PDF is allowed' }, 415);
    }

    // Nom de fichier propre
    const safeName = (file.name || 'upload.pdf')
      .replace(/\s+/g, '-')
      .replace(/[^a-zA-Z0-9.\-_]/g, '');

    // Upload vers Vercel Blob
    const blob = await put(`mf/uploads/${Date.now()}-${safeName}`, file, {
      access: 'public', // ou 'private' selon ton besoin
      contentType: type,
    });

    return cors({ url: blob.url }, 200);
  } catch (err: any) {
    console.error('PDF upload error:', err);
    return cors({ error: 'Upload failed', detail: String(err?.message || err) }, 500);
  }
}
