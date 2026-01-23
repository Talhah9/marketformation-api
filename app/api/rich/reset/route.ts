import { put } from "@vercel/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const KEY = "rich/hall.json";

function unauthorized() {
  return new Response("Unauthorized", { status: 401 });
}

async function doReset() {
  await put(KEY, JSON.stringify([]), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
  });
  return Response.json({ ok: true });
}

function checkSecret(req: Request) {
  const url = new URL(req.url);
  const secretQ = url.searchParams.get("secret");
  const secretH = req.headers.get("x-reset-secret");
  const secret = secretH || secretQ;
  return !!process.env.RICH_RESET_SECRET && secret === process.env.RICH_RESET_SECRET;
}

export async function GET(req: Request) {
  if (!checkSecret(req)) return unauthorized();
  return doReset();
}

export async function POST(req: Request) {
  if (!checkSecret(req)) return unauthorized();
  return doReset();
}
