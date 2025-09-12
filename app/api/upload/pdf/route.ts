// Upload PDF vers Shopify Files (GraphQL staged upload) avec fallback REST.
// Prérequis env: SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_API_ACCESS_TOKEN
import { put } from '@vercel/blob';
import { handleOptions, jsonWithCors } from '@/app/api/_lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PDF_MIME = 'application/pdf';
const MAX_PDF_SIZE = 50 * 1024 * 1024; // 50MB, ajuste si besoin

function sanitizeName(name: string) {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '');
}

export async function OPTIONS(req: Request) {
  return handleOptions(req);
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get('pdf');

    if (!file || !(file instanceof File)) {
      return jsonWithCors(req, { ok: false, error: 'missing_field_pdf' }, { status: 400 });
    }

    if (file.type !== PDF_MIME) {
      return jsonWithCors(
        req,
        { ok: false, error: 'invalid_mime', received: file.type, expected: PDF_MIME },
        { status: 415 }
      );
    }

    if (file.size > MAX_PDF_SIZE) {
      return jsonWithCors(req, { ok: false, error: 'file_too_large', max: MAX_PDF_SIZE }, { status: 413 });
    }

    const baseName = sanitizeName(file.name || 'document.pdf');
    const key = `uploads/pdfs/${Date.now()}-${baseName}`;
    const arrayBuffer = await file.arrayBuffer();

    const uploaded = await put(key, arrayBuffer, {
      access: 'public',
      contentType: file.type,
      addRandomSuffix: false,
    });

    return jsonWithCors(req, { ok: true, url: uploaded.url, pathname: uploaded.pathname });
  } catch (e: any) {
    return jsonWithCors(req, { ok: false, error: e?.message || 'upload_failed' }, { status: 500 });
  }
}

