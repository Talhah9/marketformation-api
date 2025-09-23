// app/api/upload/image/route.ts
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
    const file = form.get('image') as File | null;
    if (!file) {
      return new Response(JSON.stringify({ error: 'missing image' }), {
        status: 400, headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    // TODO: upload réel (S3/R2/Cloudinary/etc.)
    const url = 'https://cdn.example.com/your-uploaded.webp';

    return new Response(JSON.stringify({ url }), {
      status: 200, headers: { ...headers, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || 'upload_failed' }), {
      status: 500, headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }
}
