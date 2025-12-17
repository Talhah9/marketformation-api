// app/proxy/download/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyShopifyAppProxy } from "@/app/api/_lib/proxy";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ⚠️ App Proxy RULE :
 * - JAMAIS de status ≠ 200
 * - JAMAIS de redirect HTTP
 */
function json200(payload: any) {
  return NextResponse.json(payload, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(req: NextRequest) {
  try {
    /* 1️⃣ Vérification App Proxy */
    let verified: any;
    try {
      verified = verifyShopifyAppProxy(
        req,
        process.env.APP_PROXY_SHARED_SECRET
      );
    } catch (e: any) {
      return json200({ ok: false, error: "verify_throw", message: e?.message });
    }

    if (!verified?.ok) {
      return json200({ ok: false, error: "unauthorized" });
    }

    /* 2️⃣ Params */
    const url = new URL(req.url);
    const productId = url.searchParams.get("productId");
    const customerId = verified.loggedInCustomerId;

    if (!productId || !customerId) {
      return json200({ ok: false, error: "missing_params" });
    }

    /* 3️⃣ Vérifier que l’élève a acheté la formation */
    const purchase: any = await (prisma as any).studentCourse.findFirst({
      where: {
        shopifyCustomerId: String(customerId),
        course: {
          OR: [
            { shopifyProductId: Number(productId) },
            { productId: Number(productId) },
          ],
        },
        archived: false,
      },
      include: {
        course: true,
      },
    });

    if (!purchase || !purchase.course?.pdfUrl) {
      return json200({ ok: false, error: "not_allowed_or_missing_pdf" });
    }

    /* 4️⃣ Télécharger le PDF */
    return NextResponse.redirect(purchase.course.pdfUrl, 302);
  } catch (e: any) {
    return json200({
      ok: false,
      error: "server_error",
      message: e?.message || String(e),
    });
  }
}
