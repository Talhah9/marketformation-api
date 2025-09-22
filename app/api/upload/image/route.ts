// app/api/upload/image/route.ts
import { optionsResponse, withCorsJSON } from '@/lib/cors';
import { put } from "@vercel/blob";

export const runtime = "nodejs";

export async function OPTIONS() {
  return optionsResponse();
}

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      return withCorsJSON({ ok: false, error: "Expected multipart/form-data" }, { status: 400 });
    }

    const form = await req.formData();
    const file = form.get("image");
    if (!(file instanceof File)) {
      return withCorsJSON({ ok: false, error: "Missing 'image' file" }, { status: 400 });
    }

    // Optionnel : contrôle taille/type
    // if (!file.type.startsWith("image/")) ...

    const filename = file.name || `image_${Date.now()}`;
    const blob = await put(filename, file, {
      access: "public", // ou "private" selon ton besoin
    });

    return withCorsJSON({ ok: true, url: blob.url, pathname: blob.pathname }, { status: 200 });
  } catch (err: any) {
    return withCorsJSON({ ok: false, error: err?.message || "Upload failed" }, { status: 500 });
  }
}
