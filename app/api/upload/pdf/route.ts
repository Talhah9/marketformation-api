// app/api/upload/pdf/route.ts
import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || 'https://tqiccz-96.myshopify.com';

function withCORS(res: NextResponse) {
  res.headers.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.headers.set('Access-Control-Allow-Credentials', 'true');
  res.headers.set('Access-Control-Allow-Methods', 'POST,OPTIONS,GET');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.headers.set('Vary', 'Origin');
  return res;
}

function json(data: any, status = 200) {
  return withCORS(NextResponse.json(data, { status }));
}

// GET: smoke test (doit répondre avec CORS)
export async function GET() {
  return json({ ok: true, route: 'upload/pdf' }, 200);
}

// OPTIONS: preflight
export async function OPTIONS() {
  return withCORS(new NextResponse(null, { status: 204 }));
}

export async function POST(req: Request) {
  try {
    const origin = req.headers.get('origin') || '';
    if (origin !== ALLOWED_ORIGIN) {
      return json({ error: 'Origin not allowed', origin }, 403);
    }

    const form = await req.formData().catch((e) => { throw new Error('Invalid FormData: ' + e?.message); });
    const file = form.get('pdf');

    if (!file || !(file instanceof File)) {
      return json({ error: 'Missing file field "pdf"' }, 400);
    }

    const type = file.type || 'application/pdf';
    if (!type.includes('pdf')) {
      return json({ error: 'Only PDF is allowed' }, 415);
    }

    const safeName = (file.name || 'upload.pdf').replace(/\s+/g, '-').replace(/[^a-zA-Z0-9.\-_]/g, '');
    const blob = await put(`mf/uploads/${Date.now()}-${safeName}`, file, {
      access: 'public',
      contentType: type,
    });

    return json({ url: blob.url }, 200);
  } catch (err: any) {
    console.error('PDF upload error:', err);
    // Toujours renvoyer CORS même en erreur
    return json({ error: 'Upload failed', detail: String(err?.message || err) }, 500);
  }
}
