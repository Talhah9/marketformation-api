// app/api/upload/pdf/start/route.ts
import { NextResponse } from 'next/server';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ----- CORS -----
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || 'https://tqiccz-96.myshopify.com')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

function pickOrigin(req: Request) {
  const o = req.headers.get('origin') || '';
  return ALLOWED_ORIGINS.includes(o) ? o : ALLOWED_ORIGINS[0] || '*';
}
function withCORS(req: Request, res: NextResponse) {
  const origin = pickOrigin(req);
  res.headers.set('Access-Control-Allow-Origin', origin);
  res.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Origin, Accept, Content-Type, Authorization');
  res.headers.set('Vary', 'Origin');
  return res;
}
export async function OPTIONS(req: Request) {
  return withCORS(req, new NextResponse(null, { status: 204 }));
}

// ----- ENV S3 -----
const S3_REGION = process.env.S3_REGION!;
const S3_BUCKET = process.env.S3_BUCKET!;
const S3_PUBLIC_BASE = (process.env.S3_PUBLIC_BASE || '').replace(/\/+$/, ''); // sans trailing slash
if (!S3_REGION || !S3_BUCKET || !S3_PUBLIC_BASE) {
  // Laisse remonter au runtime pour voir le flag rouge via /api/diag/env
}

//  (facultatif) limite de taille en MB qu’on autorise à presigner
const MAX_PDF_MB = Number(process.env.PDF_MAX_SIZE_MB || 100); // ex: 100MB

// ----- Client S3 -----
const s3 = new S3Client({
  region: S3_REGION,
  credentials: process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
    ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY }
    : undefined,
});

export async function POST(req: Request) {
  try {
    const { filename, contentType, size } = await req.json().catch(() => ({} as any));
    if (!filename) {
      return withCORS(req, NextResponse.json({ ok: false, error: 'filename required' }, { status: 400 }));
    }
    // (optionnel) soft check
    if (contentType && contentType !== 'application/pdf') {
      return withCORS(req, NextResponse.json({ ok: false, error: 'Only application/pdf allowed' }, { status: 415 }));
    }
    if (size && MAX_PDF_MB > 0 && size > MAX_PDF_MB * 1024 * 1024) {
      return withCORS(req, NextResponse.json({ ok: false, error: 'File too large' }, { status: 413 }));
    }

    const safeName = String(filename).replace(/[^\w.\-]/g, '_');
    const key = `mf/pdf/${Date.now()}-${safeName}`;

    // On presigne un PUT
    const putCmd = new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      ContentType: contentType || 'application/pdf',
      // ACL: 'public-read', // seulement si ta policy l’autorise et si tu en as besoin
    });
    const uploadUrl = await getSignedUrl(s3, putCmd, { expiresIn: 60 * 5 }); // 5 minutes

    // URL publique (serving)
    const publicUrl = `${S3_PUBLIC_BASE}/${key}`;

    return withCORS(
      req,
      NextResponse.json({
        ok: true,
        method: 'PUT',
        uploadUrl,
        publicUrl,
        headers: { 'Content-Type': contentType || 'application/pdf' },
      })
    );
  } catch (e: any) {
    const msg = e?.message || 'start_failed';
    return withCORS(req, NextResponse.json({ ok: false, error: msg }, { status: 500 }));
  }
}
