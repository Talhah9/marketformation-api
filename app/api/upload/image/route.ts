import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || 'https://tqiccz-96.myshopify.com';

function withCORS(req: Request, res: NextResponse) {
  const origin = req.headers.get('origin') || '';
  if (origin === ALLOWED_ORIGIN) {
    res.headers.set('Access-Control-Allow-Origin', origin);
    res.headers.set('Vary', 'Origin');
    res.headers.set('Access-Control-Allow-Credentials', 'true'); // ← nécessaire si le front envoie credentials:'include'
    res.headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  } else {
    // si tu veux permettre plusieurs origines, gère une liste, sinon renvoie quand même CORS sur GET/OPTIONS
    res.headers.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    res.headers.set('Vary', 'Origin');
    res.headers.set('Access-Control-Allow-Credentials', 'true');
    res.headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  }
  return res;
}
function json(req: Request, data: any, status = 200) {
  return withCORS(req, NextResponse.json(data, { status }));
}

export async function GET(req: Request) {
  return json(req, { ok: true, route: 'upload/image' }, 200);
}

export async function OPTIONS(req: Request) {
  return withCORS(req, new NextResponse(null, { status: 204 }));
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get('image');
    if (!file || !(file instanceof File)) {
      return json(req, { error: 'Missing file field "image"' }, 400);
    }
    const type = file.type || 'application/octet-stream';
    if (!/^image\//.test(type)) {
      return json(req, { error: 'Only image/* allowed' }, 415);
    }

    const safeName = (file.name || 'upload').replace(/\s+/g,'-').replace(/[^a-zA-Z0-9.\-_]/g,'');
    const blob = await put(`mf/uploads/${Date.now()}-${safeName}`, file, {
      access: 'public',
      contentType: type,
    });

    return json(req, { url: blob.url }, 200);
  } catch (e: any) {
    console.error('Image upload error:', e);
    return json(req, { error: 'Upload failed', detail: String(e?.message || e) }, 500);
  }
}
