// app/api/upload/staged/finish/route.ts
import { jsonWithCors, handleOptions } from '@/app/api/_lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(req: Request) {
  return handleOptions(req);
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(()=> ({}));
    // … ta logique de finalisation d’upload (S3 / Blob / etc.)
    // Le domaine boutique vient de SHOP_DOMAIN maintenant
    const shop = process.env.SHOP_DOMAIN;
    void shop;

    return jsonWithCors(req, { ok: true });
  } catch (e:any) {
    return jsonWithCors(req, { ok:false, error: e?.message || 'finish_failed' }, { status:500 });
  }
}
