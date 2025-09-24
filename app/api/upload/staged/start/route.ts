// app/api/upload/staged/start/route.ts
import { jsonWithCors, handleOptions } from '@/app/api/_lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(req: Request) {
  return handleOptions(req);
}

/**
 * Compat: cette route "start" n'émet plus d'URL présignée.
 * Utilise désormais l’upload direct en multipart/form-data :
 *  - PDF  : POST /api/upload/pdf    (champ "pdf")
 *  - Image: POST /api/upload/image  (champ "image")
 */
export async function POST(req: Request) {
  try {
    // On lit le body au cas où un ancien front enverrait des hints (non bloquant).
    const _body = await req.json().catch(() => ({}));

    return jsonWithCors(req, {
      ok: true,
      strategy: 'multipart',
      endpoints: {
        pdf:   { url: '/api/upload/pdf',   method: 'POST', field: 'pdf' },
        image: { url: '/api/upload/image', method: 'POST', field: 'image' },
      },
      note: 'Cette route de présignature est dépréciée. Uploadez le fichier directement en multipart/form-data.',
    });
  } catch (e: any) {
    return jsonWithCors(
      req,
      { ok: false, error: e?.message || 'start_failed' },
      { status: 500 }
    );
  }
}
