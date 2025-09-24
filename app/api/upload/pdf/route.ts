// app/api/upload/pdf/route.ts
import { put } from "@vercel/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_ORIGINS = [
  "https://tqiccz-96.myshopify.com",
  "https://marketformation.fr", // ajoute/retire selon besoin
];

const MAX_SIZE = 30 * 1024 * 1024; // 30 MB max

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
function json(body: unknown, init: ResponseInit = {}, req?: Request) {
  return new Response(JSON.stringify(body), {
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
    const form = await req.formData().catch(() => null);
    if (!form) return json({ ok:false, error:"Invalid multipart body" }, { status:400 }, req);

    const file = form.get("pdf") as File | null; // ⚠️ champ attendu: "pdf"
    if (!file) return json({ ok:false, error:"Missing file 'pdf'" }, { status:400 }, req);
    if (file.size <= 0) return json({ ok:false, error:"Empty file" }, { status:400 }, req);
    if (file.size > MAX_SIZE) return json({ ok:false, error:`File too large (> ${Math.round(MAX_SIZE/1024/1024)}MB)` }, { status:413 }, req);

    const ctype = (file.type || "").toLowerCase();
    if (ctype !== "application/pdf") {
      return json({ ok:false, error:`Unsupported content-type '${ctype}'` }, { status:415 }, req);
    }

    const base = (file.name || "document").replace(/[^\w.\-]+/g, "_").slice(0, 80).replace(/\.pdf$/i, "");
    const key = `uploads/pdfs/${Date.now()}-${base}.pdf`;

    const arrayBuf = await file.arrayBuffer();
    const blob = await put(key, new Uint8Array(arrayBuf), {
      access: "public",
      contentType: "application/pdf",
      addRandomSuffix: false,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });

    return new Response(JSON.stringify({ ok:true, url: blob.url }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders(req) },
    });
  } catch (e:any) {
    return new Response(JSON.stringify({ ok:false, error: e?.message || "upload_failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders(req) },
    });
  }
}
