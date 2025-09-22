// app/api/upload/pdf/route.ts
import { optionsResponse, withCorsJSON } from "@/lib/cors";
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
    const file = form.get("pdf");
    if (!(file instanceof File)) {
      return withCorsJSON({ ok: false, error: "Missing 'pdf' file" }, { status: 400 });
    }

    // Optionnel: valider type/poids
    // if (file.type !== "application/pdf") ...

    const filename = file.name || `file_${Date.now()}.pdf`;
    const blob = await put(filename, file, {
      access: "public", // "private" si tu veux protéger l'accès
    });

    return withCorsJSON({ ok: true, url: blob.url, pathname: blob.pathname }, { status: 200 });
  } catch (err: any) {
    return withCorsJSON({ ok: false, error: err?.message || "Upload failed" }, { status: 500 });
  }
}
