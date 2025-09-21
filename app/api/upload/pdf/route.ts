import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { withCORS, corsOptions } from '@/app/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(req: Request) { return corsOptions(req); }
export async function GET(req: Request) { return withCORS(req, NextResponse.json({ ok:true, route:'upload/pdf' })); }

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get('pdf');
    if (!file || !(file instanceof File)) {
      return withCORS(req, NextResponse.json({ ok:false, error:'Missing "pdf"' }, { status:400 }));
    }
    const type = file.type || 'application/octet-stream';
    if (type !== 'application/pdf') {
      return withCORS(req, NextResponse.json({ ok:false, error:'Only application/pdf allowed' }, { status:415 }));
    }

    // ⚠️ limite raisonnable pour éviter 413 sur function — on reste sur 12 Mo
    if (file.size > 12 * 1024 * 1024) {
      return withCORS(req, NextResponse.json({ ok:false, error:'PDF too large (max 12MB)' }, { status:413 }));
    }

    const safeName = (file.name || 'file.pdf')
      .replace(/\s+/g,'-')
      .replace(/[^a-zA-Z0-9.\-_]/g,'');
    const key = `mf/uploads/pdf/${Date.now()}-${safeName}`;

    const blob = await put(key, file as File, {
      access: 'public',
      contentType: type,
      addRandomSuffix: false,
    });

    return withCORS(req, NextResponse.json({ ok:true, url: blob.url }, { status:200 }));
  } catch (e:any) {
    console.error('pdf upload error', e);
    return withCORS(req, NextResponse.json({ ok:false, error:'Upload failed' }, { status:500 }));
  }
}
