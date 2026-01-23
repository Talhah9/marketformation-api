export const runtime = "nodejs";

const ALLOW_ORIGINS = new Set(["https://iamrich.fr", "https://www.iamrich.fr"]);

type HallItem = {
  name: string;
  createdAt: number;
  // optionnel si tu le stockes
  sessionId?: string;
};

function corsHeaders(origin: string | null) {
  const allowed = origin && ALLOW_ORIGINS.has(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "https://iamrich.fr",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  } as const;
}

export async function OPTIONS(req: Request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(req.headers.get("origin")),
  });
}

export async function GET(req: Request) {
  // ✅ Placeholder (tu remplaceras par Blob/DB)
  const items: HallItem[] = [];

  return Response.json(
    { ok: true, items },
    {
      status: 200,
      headers: {
        ...corsHeaders(req.headers.get("origin")),
        "Cache-Control": "no-store",
      },
    }
  );
}
