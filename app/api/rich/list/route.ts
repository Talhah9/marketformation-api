import { list as blobList, put } from "@vercel/blob";

export const runtime = "nodejs";

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

async function readHall(): Promise<HallItem[]> {
  const found = await blobList({ prefix: KEY, limit: 1 });
  const item = found.blobs?.[0];
  if (!item?.url) return [];
  const res = await fetch(item.url, { cache: "no-store" });
  if (!res.ok) return [];
  const data = await res.json().catch(() => []);
  return Array.isArray(data) ? (data as HallItem[]) : [];
}

async function ensureFileExists() {
  const found = await blobList({ prefix: KEY, limit: 1 });
  if (!found.blobs?.length) {
    await put(KEY, JSON.stringify([]), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
    });
  }
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

export async function GET(req: Request) {
  await ensureFileExists();
  const items = await readHall();

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
