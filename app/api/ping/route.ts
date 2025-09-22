// app/api/ping/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  Vary: 'Origin',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET() {
  return new Response(JSON.stringify({ ok: true, pong: true, ts: Date.now() }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

