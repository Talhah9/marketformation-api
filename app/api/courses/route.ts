import { optionsResponse, withCorsJSON } from "@/lib/cors";

export const runtime = "nodejs";

export async function OPTIONS() {
  return optionsResponse();
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    // TODO: appelle Shopify Admin ici si besoin
    const demo = { ok: true, productId: "gid://shopify/Product/1234567890", body };
    return withCorsJSON(demo, { status: 200 });
  } catch (e: any) {
    return withCorsJSON({ ok: false, error: e?.message || "Failed to create course" }, { status: 500 });
  }
}
