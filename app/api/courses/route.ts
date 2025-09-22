import { optionsResponse, withCorsJSON } from "@/lib/cors";

export const runtime = "nodejs";

export async function OPTIONS() {
  return optionsResponse();
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    // TODO: ici ton appel Shopify Admin (création produit + metafield mfapp.pdf_url)
    // const productId = await createShopifyProduct(body);

    const demo = {
      ok: true,
      productId: "gid://shopify/Product/1234567890",
    };
    return withCorsJSON(demo, { status: 200 });
  } catch (e: any) {
    return withCorsJSON({ ok: false, error: e?.message || "Failed to create course" }, { status: 500 });
  }
}
