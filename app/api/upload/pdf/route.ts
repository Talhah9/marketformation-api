// app/api/upload/pdf/route.ts
import { jsonWithCors, handleOptions } from "@/app/api/_lib/cors";
import { put } from "@vercel/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // jamais de cache pour les uploads

const MAX_MB = Number(process.env.UPLOAD_MAX_MB || 25);
const MAX_BYTES = MAX_MB * 1024 * 1024;

export async function OPTIONS(req: Request) {
  return handleOptions(req);
}

export async function GET(req: Request) {
  // ping de santé (utile pour vérifier les en-têtes CORS)
  return jsonWithCors(req, { ok: true, endpoint: "upload/pdf", method: "GET" });
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("pdf");

    if (!file || typeof file === "string") {
      return jsonWithCors(req, { ok: false, error: "Missing field 'pdf'." }, { status: 400 });
    }

    // @ts-ignore – Next File implémente arrayBuffer()/stream()
    const f: File = file;

    // validation type/poids
    const ct = (f.type || "").toLowerCase();
    if (!ct.includes("pdf")) {
      return jsonWithCors(req, { ok: false, error: "Only application/pdf accepted." }, { status: 415 });
    }
    if ((f.size || 0) > MAX_BYTES) {
      return jsonWithCors(
        req,
        { ok: false, error: `File too large (> ${MAX_MB}MB).` },
        { status: 413 },
      );
    }

    // upload Vercel Blob (public)
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      return jsonWithCors(req, { ok: false, error: "Missing BLOB_READ_WRITE_TOKEN" }, { status: 500 });
    }

    const name = (f.name || "file.pdf").replace(/[^\w.\-]+/g, "_");
    const key = `mf/uploads/pdf/${Date.now()}-${name}`;

    // put accepte un Blob/File directement
    const { url } = await put(key, f, {
      access: "public",
      contentType: "application/pdf",
      token,
      addRandomSuffix: false,
    });

    return jsonWithCors(req, { ok: true, url });
  } catch (e: any) {
    // IMPORTANT : on répond via jsonWithCors pour conserver les en-têtes CORS
    return jsonWithCors(
      req,
      { ok: false, error: e?.message || "upload_pdf_failed" },
      { status: 500 },
    );
  }
}
