// app/api/courses/route.ts

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

// GET: renvoie une liste au bon format (vide pour l’instant)
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const email = (searchParams.get("email") || "").toLowerCase();

  const items: Array<{ title: string; coverUrl?: string; collectionHandle?: string; handle?: string; email?: string; }> = [];

  // 👉 Décommente pour voir 2 cartes de test immédiatement
  // if (email) {
  //   items.push(
  //     { title: "Intro IA", coverUrl: "https://picsum.photos/seed/ia/600/320", collectionHandle: "intelligence-artificielle", handle: "intro-ia", email },
  //     { title: "Vendre sa 1ère formation", coverUrl: "https://picsum.photos/seed/sales/600/320", collectionHandle: "business", handle: "vendre-premiere-formation", email }
  //   );
  // }

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
