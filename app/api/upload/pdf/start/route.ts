// app/api/upload/pdf/start/route.ts
import { NextResponse } from 'next/server';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOW_ORIGIN = (process.env.CORS_ORIGINS || '').split(',')[0] || 'https://tqiccz-96.myshopify.com';
function withCORS(res: Response, origin?: string) {
  const r = new Response(res.body, res);
  r.headers.set('Access-Control-Allow-Origin', origin || ALLOW_ORIGIN);
  r.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  r.headers.set('Access-Control-Allow-Headers', 'Origin, Accept, Content-Type, Authorization');
  r.headers.set('Vary', 'Origin');
  return r;
}

export async function OPTIONS(req: Request) {
  return withCORS(new Response(null, { status: 204 }), req.headers.get('origin') || undefined);
}

function safe(name: string) { return name.replace(/[^\w.\-]/g, '_'); }

export async function POST(req: Request) {
  const origin = req.headers.get('origin') || undefined;
  try {
    const { filename, contentType } = await req.json().catch(() => ({}));
    if (!filename) {
      return withCORS(new Response(JSON.stringify({ ok:false, error:'filename required' }), {
        status:400, headers:{'Content-Type':'application/json'}
      }), origin);
    }

    const region = process.env.S3_REGION!;
    const bucket = process.env.S3_BUCKET!;
    const publicBase = (process.env.S3_PUBLIC_BASE || '').replace(/\/+$/,''); // ex: https://cdn.mondomaine.com
    if (!region || !bucket || !publicBase) {
      return withCORS(new Response(JSON.stringify({ ok:false, error:'S3 env missing' }), {
        status:500, headers:{'Content-Type':'application/json'}
      }), origin);
    }

    const key = `mf/pdf/${Date.now()}-${safe(filename)}`;
    const s3 = new S3Client({
      region,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
      },
    });

    const cmd = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType || 'application/pdf',
      ACL: 'public-read', // si ton bucket est configuré pour, sinon retire et sers via CloudFront + policy
    });

    const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 600 }); // 10 min
    const publicUrl = `${publicBase}/${key}`;

    return withCORS(new Response(JSON.stringify({
      ok: true,
      method: 'PUT',
      headers: { 'Content-Type': contentType || 'application/pdf' },
      uploadUrl,
      publicUrl,
    }), { status:200, headers:{'Content-Type':'application/json'} }), origin);
  } catch (e:any) {
    return withCORS(new Response(JSON.stringify({ ok:false, error:e?.message || 'start_failed' }), {
      status:500, headers:{'Content-Type':'application/json'}
    }), origin);
  }
}
