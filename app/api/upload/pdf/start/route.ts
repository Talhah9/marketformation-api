import { optionsResponse, withCorsJSON } from "@/lib/cors";
import { generateUploadURL } from "@vercel/blob";

export const runtime = "nodejs";

export async function OPTIONS() {
  return optionsResponse();
}

export async function POST(req: Request) {
  try {
    const { filename = `file_${Date.now()}.pdf`, contentType = "application/pdf" } =
      await req.json().catch(() => ({}));

    const { url, id, token } = await generateUploadURL({
      contentType,
      // allowedContentTypes: ["application/pdf"],
      // maximumSizeInBytes: 10 * 1024 * 1024,
    });

    return withCorsJSON({ ok: true, uploadURL: url, id, token, filename }, { status: 200 });
  } catch (e: any) {
    return withCorsJSON({ ok: false, error: e?.message || "Failed to create upload URL" }, { status: 500 });
  }
}
