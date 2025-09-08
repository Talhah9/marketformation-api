// TEMP FIX: neutralise l’onboarding pour ne rien faire au build
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET() {
  return Response.json({ ok: true, note: 'onboard noop (temp)' });
}
export async function POST() {
  return Response.json({ ok: true, note: 'onboard noop (temp)' });
}
