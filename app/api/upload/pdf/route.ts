// app/api/upload/pdf/route.ts (sur mf-api-gold)
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWLIST = new Set<string>([
  process.env.ALLOW_ORIGIN || 'https://tqiccz-96.myshopify.com',
]);

function corsHeaders(origin?: string) {
  const h: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
  if (origin && ALLOWLIST.has(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    // Si tu utilises des cookies/sessions:
    // h['Access-Control-Allow-Credentials'] = 'true';
  }
  return h;
}

export async function OPTIONS(req: Request) {
  const origin = req.headers.get('origin') || undefined;
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function POST(req: Request) {
  const origin = req.headers.get('origin') || undefined;
  const headers = corsHeaders(origin);
  try {
    const form = await req.formData();
    const file = form.get('pdf') as File | null;
    if (!file) {
      return new Response(JSON.stringify({ error: 'missing pdf' }), {
        status: 400, headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }
    // TODO: upload réel du PDF et retourne l'URL finale
    const url = 'https://cdn.example.com/your-uploaded.pdf';
    return new Response(JSON.stringify({ url }), {
      status: 200, headers: { ...headers, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || 'upload_failed' }), {
      status: 500, headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }
}
