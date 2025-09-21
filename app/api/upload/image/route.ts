import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { withCORS, corsOptions } from '@/app/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(req: Request) { return corsOptions(req); }
export async function GET(req: Request) { return withCORS(req, NextResponse.json({ ok:true, route:'upload/image' })); }

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get('image');
    if (!file || !(file instanceof File)) {
      return withCORS(req, NextResponse.json({ ok:false, error:'Missing "image"' }, { status:400 }));
    }
    const type = file.type || 'application/octet-stream';
    if (!/^image\//.test(type)) {
      return withCORS(req, NextResponse.json({ ok:false, error:'Only images allowed' }, { status:415 }));
    }

    // (optionnel) petite limite raisonnable, pour éviter des 413 en edge
    if (file.size > 8 * 1024 * 1024) {
      return withCORS(req, NextResponse.json({ ok:false, error:'Image too large (max 8MB)' }, { status:413 }));
    }

    const safeName = (file.name || 'image')
      .replace(/\s+/g,'-')
      .replace(/[^a-zA-Z0-9.\-_]/g,'');
    const key = `mf/uploads/image/${Date.now()}-${safeName}`;

    const blob = await put(key, file as File, {
      access: 'public',
      contentType: type,
      addRandomSuffix: false,
    });

    return withCORS(req, NextResponse.json({ ok:true, url: blob.url }, { status:200 }));
  } catch (e:any) {
    console.error('image upload error', e);
    return withCORS(req, NextResponse.json({ ok:false, error:'Upload failed' }, { status:500 }));
  }
}
