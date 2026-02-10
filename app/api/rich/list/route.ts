import { head, put } from "@vercel/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const KEY = "rich/hall.json";
const ALLOW_ORIGINS = new Set(["https://iamrich.fr", "https://www.iamrich.fr"]);

type HallItem = {
  name: string;
  createdAt: number;
  sessionId: string;
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

async function ensureFileExists() {
  try {
    await head(KEY);
  } catch {
    await put(KEY, JSON.stringify([]), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
    });
  }
}

async function readHall(): Promise<HallItem[]> {
  try {
    const meta = await head(KEY);
    const res = await fetch(meta.url + "?t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json().catch(() => []);
    return Array.isArray(data) ? (data as HallItem[]) : [];
  } catch {
    return [];
  }
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

export async function GET(req: Request) {
  await ensureFileExists();
  const items = await readHall();

  return new Response(JSON.stringify({ ok: true, items }), {
    status: 200,
    headers: {
      ...corsHeaders(req.headers.get("origin")),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
