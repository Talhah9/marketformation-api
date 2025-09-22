// app/api/upload/pdf/start/route.ts
import { optionsResponse, withCorsJSON } from '@/lib/cors';
import { generateUploadURL } from "@vercel/blob";

export const runtime = "nodejs";

export async function OPTIONS() {
  return optionsResponse();
}

export async function POST(req: Request) {
  try {
    // Tu peux valider l'origine Shopify ici si besoin:
    // const origin = req.headers.get("origin");
    // if (origin !== process.env.CORS_ORIGIN) return withCorsJSON({ ok: false, error: "Origin not allowed" }, { status: 403 });

    const { filename = `file_${Date.now()}.pdf`, contentType = "application/pdf" } = await req.json().catch(() => ({}));

    const { url, id, token } = await generateUploadURL({
      contentType,
      // Pour limiter par type/taille:
      // allowedContentTypes: ["application/pdf"],
      // maximumSizeInBytes: 10 * 1024 * 1024,
    });

    return withCorsJSON({ ok: true, uploadURL: url, id, token, filename }, { status: 200 });
  } catch (err: any) {
    return withCorsJSON({ ok: false, error: err?.message || "Failed to create upload URL" }, { status: 500 });
  }
}
