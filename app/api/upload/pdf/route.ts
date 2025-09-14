// Upload PDF vers Shopify Files (GraphQL staged upload) avec fallback REST.
// Prérequis env: SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_API_ACCESS_TOKEN
import { put } from '@vercel/blob';
import { handleOptions, jsonWithCors } from '@/app/api/_lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PDF_MIME = 'application/pdf';
const MAX_PDF_SIZE = 50 * 1024 * 1024; // 50 MB

function sanitizeName(name: string) {
  return (name || 'document.pdf')
    .toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9._-]/g, '');
}

export async function OPTIONS(req: Request) { return handleOptions(req); }

export async function POST(req: Request) {
  try {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      return jsonWithCors(req, { ok:false, error:'blob_token_missing' }, { status:500 });
    }

    const form = await req.formData();
    const file = form.get('pdf');

    if (!file || !(file instanceof File)) {
      return jsonWithCors(req, { ok:false, error:'missing_field_pdf' }, { status:400 });
    }
    if (file.type !== PDF_MIME) {
      return jsonWithCors(req, { ok:false, error:'invalid_mime', received:file.type, expected:PDF_MIME }, { status:415 });
    }
    if (file.size > MAX_PDF_SIZE) {
      return jsonWithCors(req, { ok:false, error:'file_too_large', max:MAX_PDF_SIZE }, { status:413 });
    }

    const key = `uploads/pdfs/${Date.now()}-${sanitizeName(file.name)}`;

    const uploaded = await put(key, file, {
      access: 'public',
      contentType: file.type,
      addRandomSuffix: false,
      token,                        // ← IMPORTANT
    });

    return jsonWithCors(req, { ok:true, url: uploaded.url, pathname: uploaded.pathname });
  } catch (e: any) {
    console.error('upload/pdf error:', e);
    return jsonWithCors(req, { ok:false, error: e?.message || 'upload_failed' }, { status:500 });
  }
}

