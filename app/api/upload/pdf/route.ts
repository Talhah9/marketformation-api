import { optionsResponse, withCorsJSON } from "@/lib/cors";
import { put } from "@vercel/blob";

export const runtime = "nodejs";

export async function OPTIONS() {
  return optionsResponse();
}

export async function POST(req: Request) {
  try {
    const ct = req.headers.get("content-type") || "";
    if (!ct.includes("multipart/form-data")) {
      return withCorsJSON({ ok: false, error: "Expected multipart/form-data" }, { status: 400 });
    }
    const form = await req.formData();
    const file = form.get("pdf");
    if (!(file instanceof File)) {
      return withCorsJSON({ ok: false, error: "Missing 'pdf' file" }, { status: 400 });
    }
    const filename = file.name || `file_${Date.now()}.pdf`;
    const blob = await put(filename, file, { access: "public" });
    return withCorsJSON({ ok: true, url: blob.url, pathname: blob.pathname }, { status: 200 });
  } catch (e: any) {
    return withCorsJSON({ ok: false, error: e?.message || "Upload failed" }, { status: 500 });
  }
}
