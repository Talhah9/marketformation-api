// app/api/upload/pdf/route.ts
import { handleOptions, jsonWithCors } from '@/app/api/_lib/cors';
import { put } from '@vercel/blob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(req: Request) {
  return handleOptions(req);
}
export async function GET(req: Request) {
  return jsonWithCors(req, { ok: true, endpoint: 'upload/pdf', method: 'GET' });
}
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get('pdf');
    if (!(file instanceof File)) {
      return jsonWithCors(req, { ok: false, error: 'pdf_missing' }, { status: 400 });
    }
    // Upload public sur Vercel Blob (req: BLOB_READ_WRITE_TOKEN en env)
    const name = (file as File).name || 'file.pdf';
    const ext = name.split('.').pop()?.toLowerCase() || 'pdf';
    const key = `uploads/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    const { url } = await put(key, file as File, {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'application/pdf',
    });

    return jsonWithCors(req, { ok: true, url });
  } catch (e: any) {
    console.error('[upload/pdf]', e);
    return jsonWithCors(req, { ok: false, error: e?.message || 'upload_failed' }, { status: 500 });
  }
}
