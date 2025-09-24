// app/api/subscription/route.ts
import { jsonWithCors, handleOptions } from '@/app/api/_lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function getPlanFor(email: string) {
  // … récupère le plan (Pro/Starter/etc.) selon Stripe/BDD
  return { planKey: 'pro', status: 'active', currentPeriodEnd: Math.floor(Date.now()/1000) };
}

export async function OPTIONS(req: Request) {
  return handleOptions(req);
}

export async function POST(req: Request) {
  try {
    const { email } = await req.json().catch(() => ({}));
    if (!email) return jsonWithCors(req, { ok: false, error: 'email required' }, { status: 400 });

    const s = await getPlanFor(email);
    return jsonWithCors(req, { ok: true, ...s });
  } catch (e: any) {
    return jsonWithCors(req, { ok: false, error: e?.message || 'subscription_failed' }, { status: 500 });
  }
}
