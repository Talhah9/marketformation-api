// TEMP FIX: empêcher le prerender et ne rien appeler pendant le build
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET() {
  return Response.json({ ok: true, note: 'onboard noop (temp)' });
}

export async function POST() {
  return Response.json({ ok: true, note: 'onboard noop (temp)' });
}
