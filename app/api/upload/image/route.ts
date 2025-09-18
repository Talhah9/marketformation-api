// app/api/upload/image/route.ts
import { jsonWithCors, handleOptions } from "@/app/api/_lib/cors";
import { put } from "@vercel/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MB = Number(process.env.UPLOAD_MAX_MB || 10);
const MAX_BYTES = MAX_MB * 1024 * 1024;

export async function OPTIONS(req: Request) {
  return handleOptions(req);
}

export async function GET(req: Request) {
  return jsonWithCors(req, { ok: true, endpoint: "upload/image", method: "GET" });
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("image");

    if (!file || typeof file === "string") {
      return jsonWithCors(req, { ok: false, error: "Missing field 'image'." }, { status: 400 });
    }

    // @ts-ignore
    const f: File = file;

    const ct = (f.type || "").toLowerCase();
    const okType = /(png|jpe?g|webp)/.test(ct);
    if (!okType) {
      return jsonWithCors(req, { ok: false, error: "Only PNG/JPG/WEBP accepted." }, { status: 415 });
    }
    if ((f.size || 0) > MAX_BYTES) {
      return jsonWithCors(
        req,
        { ok: false, error: `File too large (> ${MAX_MB}MB).` },
        { status: 413 },
      );
    }

    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      return jsonWithCors(req, { ok: false, error: "Missing BLOB_READ_WRITE_TOKEN" }, { status: 500 });
    }

    const name = (f.name || "image").replace(/[^\w.\-]+/g, "_");
    const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg";
    const key = `mf/uploads/img/${Date.now()}-${name}.${ext}`;

    const { url } = await put(key, f, {
      access: "public",
      contentType: ct || `image/${ext}`,
      token,
      addRandomSuffix: false,
    });

    return jsonWithCors(req, { ok: true, url });
  } catch (e: any) {
    return jsonWithCors(
      req,
      { ok: false, error: e?.message || "upload_image_failed" },
      { status: 500 },
    );
  }
}
