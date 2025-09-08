// app/api/courses/route.ts

// CORS permissif : autorise toutes les origines (pas d'include credentials côté front)
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Vary": "Origin"
};

function jsonCors(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS }
  });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

// GET: renvoie un tableau vide au bon format (et ça suffit pour enlever l'erreur)
export async function GET(req: Request) {
  // Si tu veux tester l’affichage tout de suite, décommente les 2 items
  // const q = new URL(req.url).searchParams;
  // const email = (q.get("email") || "").toLowerCase();
  // const items = email ? [
  //   { title: "Intro IA", coverUrl: "https://picsum.photos/seed/ia/600/320", collectionHandle: "intelligence-artificielle", handle: "intro-ia" },
  //   { title: "Vendre sa 1ère formation", coverUrl: "https://picsum.photos/seed/sales/600/320", collectionHandle: "business", handle: "vendre-premiere-formation" }
  // ] : [];
  const items: any[] = [];
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
