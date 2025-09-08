const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || "https://tqiccz-96.myshopify.com";

function jsonCors(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Vary": "Origin"
    }
  });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Vary": "Origin"
    }
  });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const email = (searchParams.get("email") || "").toLowerCase();
  const items: Array<{ title: string; coverUrl?: string; collectionHandle?: string; handle?: string; email?: string; }> = [];
  return jsonCors({ items });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    return jsonCors({ ok: true, id: `tmp_${Date.now()}`, received: body }, 200);
  } catch {
    return jsonCors({ error: "invalid json" }, 400);
  }
}
