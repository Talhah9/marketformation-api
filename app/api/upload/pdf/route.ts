import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || 'https://tqiccz-96.myshopify.com';

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
  return withCORS(req, NextResponse.json({ ok: true, route: 'upload/pdf' }, { status: 200 }));
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get('pdf');
    if (!file || !(file instanceof File)) {
      return withCORS(req, NextResponse.json({ error: 'Missing file field "pdf"' }, { status: 400 }));
    }
    const type = (file as File).type || 'application/octet-stream';
    if (type !== 'application/pdf') {
      return withCORS(req, NextResponse.json({ error: 'Only application/pdf allowed' }, { status: 415 }));
    }

    const safe = ((file as File).name || 'upload.pdf')
      .replace(/\s+/g,'-')
      .replace(/[^a-zA-Z0-9.\-_]/g,'');

    const key = `mf/uploads/pdf/${Date.now()}-${safe}`;

    const blob = await put(key, file as File, {
      access: 'public',
      contentType: type,
      addRandomSuffix: false,
    });

    return withCORS(req, NextResponse.json({ url: blob.url }, { status: 200 }));
  } catch (e: any) {
    console.error('PDF upload error:', e);
    return withCORS(req, NextResponse.json({ error: 'Upload failed', detail: String(e?.message || e) }, { status: 500 }));
  }
}
