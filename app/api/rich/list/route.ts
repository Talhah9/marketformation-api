import { list, put } from "@vercel/blob";

export const runtime = "nodejs";

const KEY = "rich/hall.json";

type Entry = { name: string; createdAt: number; sessionId: string };

async function readHall(): Promise<Entry[]> {
  const found = await list({ prefix: KEY, limit: 1 });
  const item = found.blobs?.[0];
  if (!item?.url) return [];
  const res = await fetch(item.url, { cache: "no-store" });
  if (!res.ok) return [];
  const data = await res.json().catch(() => []);
  return Array.isArray(data) ? data : [];
}

async function writeHall(entries: Entry[]) {
  await put(KEY, JSON.stringify(entries), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
  });
}

export async function GET() {
  // si le fichier n’existe pas encore, on le crée une fois
  const hall = await readHall();
  if (!hall.length) {
    await writeHall([]);
  }
  return Response.json({ ok: true, items: hall }, { status: 200 });
}
