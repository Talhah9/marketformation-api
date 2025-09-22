// app/api/courses/route.ts
import { optionsResponse, withCorsJSON } from '@/lib/cors';

export const runtime = "nodejs";

export async function OPTIONS() {
  return optionsResponse();
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    // title, description, image_url, pdf_url, collection_id, etc.
    // Ex: const { title, description, image_url, pdf_url } = body;

    // TODO: remplace par ton appel Shopify Admin GraphQL/REST
    // const productId = await createShopifyProduct(body);

    const demo = {
      ok: true,
      productId: "gid://shopify/Product/1234567890",
      // metafield: { namespace: "mfapp", key: "pdf_url", value: pdf_url }
    };
    return withCorsJSON(demo, { status: 200 });
  } catch (err: any) {
    return withCorsJSON({ ok: false, error: err?.message || "Failed to create course" }, { status: 500 });
  }
}
