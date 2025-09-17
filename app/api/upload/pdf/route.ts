// app/api/upload/pdf/route.ts
import { put } from '@vercel/blob';
import { handleOptions, jsonWithCors } from '@/app/api/_lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PDF_MIME = 'application/pdf';
const MAX_PDF_SIZE = 50 * 1024 * 1024; // 50 MB

function sanitizeName(name: string) {
  return (name || 'document.pdf')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '');
}

/** Préflight CORS */
export async function OPTIONS(req: Request) {
  return handleOptions(req);
}

/** Petit GET de debug (permet de vérifier les headers CORS dans le navigateur) */
export async function GET(req: Request) {
  return jsonWithCors(req, { ok: true, endpoint: 'upload/pdf', method: 'GET' });
}

/** Upload PDF */
export async function POST(req: Request) {
  try {
    // IMPORTANT: si le token n’est pas là, on renvoie quand même une réponse CORS (pas de throw brut)
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      return jsonWithCors(
        req,
        { ok: false, error: 'blob_token_missing' },
        { status: 500 }
      );
    }

    const form = await req.formData().catch(() => null);
    if (!form) {
      return jsonWithCors(
        req,
        { ok: false, error: 'invalid_formdata' },
        { status: 400 }
      );
    }

    const file = form.get('pdf');
    if (!file || !(file instanceof File)) {
      return jsonWithCors(
        req,
        { ok: false, error: 'missing_field_pdf' },
        { status: 400 }
      );
    }

    // Validations simples (toujours avant l’upload)
    if (file.type !== PDF_MIME) {
      return jsonWithCors(
        req,
        { ok: false, error: 'invalid_mime', received: file.type, expected: PDF_MIME },
        { status: 415 }
      );
    }
    if (file.size > MAX_PDF_SIZE) {
      return jsonWithCors(
        req,
        { ok: false, error: 'file_too_large', max: MAX_PDF_SIZE },
        { status: 413 }
      );
    }

    // Upload → Vercel Blob
    const key = `uploads/pdfs/${Date.now()}-${sanitizeName(file.name)}`;
    const uploaded = await put(key, file, {
      access: 'public',
      contentType: file.type,
      addRandomSuffix: false,
      token, // OBLIGATOIRE: sinon 401/403 côté Blob
    });

    // Réponse CORS OK
    return jsonWithCors(req, {
      ok: true,
      url: uploaded.url,
      pathname: uploaded.pathname,
      size: file.size,
      mime: file.type,
    });
  } catch (e: any) {
    // On log côté serveur, mais on renvoie TOUJOURS via jsonWithCors pour éviter l’erreur CORS
    console.error('upload/pdf error:', e);
    return jsonWithCors(
      req,
      { ok: false, error: e?.message || 'upload_failed' },
      { status: 500 }
    );
  }
}
