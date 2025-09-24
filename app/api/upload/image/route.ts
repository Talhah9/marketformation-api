// app/api/upload/image/route.ts
import { put } from "@vercel/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_ORIGINS = [
  "https://tqiccz-96.myshopify.com",
  "https://marketformation.fr", // ton domaine si besoin
];

const MAX_SIZE = 8 * 1024 * 1024; // 8 MB max

function pickAllowedOrigin(req: Request) {
  const origin = req.headers.get("origin") || "";
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
}

function corsHeaders(req: Request) {
  return {
    "Access-Control-Allow-Origin": pickAllowedOrigin(req),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

function json(resBody: unknown, init: ResponseInit = {}, req?: Request) {
  return new Response(JSON.stringify(resBody), {
    status: init.status ?? 200,
    headers: {
      "Content-Type": "application/json",
      ...(req ? corsHeaders(req) : {}),
      ...(init.headers || {}),
    },
  });
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export async function POST(req: Request) {
  try {
    // --- CORS ---
    const headers = corsHeaders(req);

    // --- Multipart ---
    const form = await req.formData().catch(() => null);
    if (!form) return json({ ok: false, error: "Invalid multipart body" }, { status: 400 }, req);

    const file = form.get("image") as File | null;
    if (!file) return json({ ok: false, error: "Missing file 'image'" }, { status: 400 }, req);

    // --- Validation basique ---
    if (file.size <= 0) return json({ ok: false, error: "Empty file" }, { status: 400 }, req);
    if (file.size > MAX_SIZE) return json({ ok: false, error: `File too large (> ${Math.round(MAX_SIZE/1024/1024)}MB)` }, { status: 413 }, req);

    // Types d’image autorisés (peux élargir: image/webp, etc.)
    const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
    const ctype = (file.type || "").toLowerCase();
    if (!allowed.has(ctype)) {
      return json({ ok: false, error: `Unsupported content-type '${ctype}'` }, { status: 415 }, req);
    }

    // --- Nom de fichier propre ---
    const orig = (file.name || "image").replace(/[^\w.\-]+/g, "_").slice(0, 80);
    const ext =
      ctype === "image/png" ? ".png" :
      ctype === "image/webp" ? ".webp" : ".jpg";
    const key = `uploads/images/${Date.now()}-${orig.replace(/\.[^.]+$/, "")}${ext}`;

    // --- Upload vers Vercel Blob ---
    // Nécessite BLOB_READ_WRITE_TOKEN en env
    const arrayBuf = await file.arrayBuffer();
    const blob = await put(key, new Uint8Array(arrayBuf), {
      access: "public",
      contentType: ctype,
      addRandomSuffix: false,
      token: process.env.BLOB_READ_WRITE_TOKEN, // sécurité: jamais côté front
    });

    // blob.url est public
    return new Response(JSON.stringify({ ok: true, url: blob.url }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e?.message || "upload_failed" }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        ...(corsHeaders as any)(undefined),
      },
    });
  }
}
