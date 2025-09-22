// app/api/upload/image/route.ts
import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_ORIGIN =
  process.env.CORS_ORIGIN || 'https://tqiccz-96.myshopify.com';

function withCORS(req: Request, res: NextResponse, methods = 'GET,POST,OPTIONS') {
  const origin = req.headers.get('origin') || ALLOWED_ORIGIN;
  res.headers.set('Access-Control-Allow-Origin', origin);
  res.headers.set('Vary', 'Origin');
  res.headers.set('Access-Control-Allow-Methods', methods);
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  return res;
}

export async function OPTIONS(req: Request) {
  return withCORS(req, new NextResponse(null, { status: 204 }));
}

export async function GET(req: Request) {
  return withCORS(req, NextResponse.json({ ok: true, route: 'upload/image' }));
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get('image');
    if (!file || !(file instanceof File)) {
      return withCORS(req, NextResponse.json({ error: 'Missing file field "image"' }, { status: 400 }));
    }
    const type = file.type || 'application/octet-stream';
    if (!/^image\//.test(type)) {
      return withCORS(req, NextResponse.json({ error: 'Only image/* allowed' }, { status: 415 }));
    }
    const safe = (file.name || 'upload').replace(/\s+/g,'-').replace(/[^a-zA-Z0-9.\-_]/g,'');
    const key = `mf/uploads/image/${Date.now()}-${safe}`;
    const blob = await put(key, file, { access:'public', contentType:type, addRandomSuffix:false });

    return withCORS(req, NextResponse.json({ url: blob.url }, { status: 200 }));
  } catch (e: any) {
    return withCORS(req, NextResponse.json({ error: 'Upload failed', detail: String(e?.message || e) }, { status: 500 }));
  }
}
