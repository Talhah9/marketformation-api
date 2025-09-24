// app/api/upload/staged/start/route.ts
import { jsonWithCors, handleOptions } from '@/app/api/_lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(req: Request) {
  return handleOptions(req);
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(()=> ({}));
    // … ta logique de pré-signature (S3, etc.)
    const shop = process.env.SHOP_DOMAIN;
    void shop;

    return jsonWithCors(req, { ok: true, uploadUrl: 'https://example.com/put-url' });
  } catch (e:any) {
    return jsonWithCors(req, { ok:false, error: e?.message || 'start_failed' }, { status:500 });
  }
}
