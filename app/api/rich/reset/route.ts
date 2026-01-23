import { put } from "@vercel/blob";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const secret = req.headers.get("x-reset-secret");
  if (!process.env.RICH_RESET_SECRET || secret !== process.env.RICH_RESET_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  await put("rich/hall.json", JSON.stringify([]), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
  });

  return Response.json({ ok: true });
}
