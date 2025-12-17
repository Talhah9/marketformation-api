// app/proxy/download/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyShopifyAppProxy } from "@/app/api/_lib/proxy";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ⚠️ Shopify App Proxy rule:
 * - toujours répondre en 200
 * - ne jamais throw
 * - pas de 401 / 403 / 500
 */
function json200(payload: any) {
  return NextResponse.json(payload, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(req: NextRequest) {
  try {
    /* =====================================================
       1) Vérification App Proxy
       ===================================================== */
    let verified: any;
    try {
      verified = verifyShopifyAppProxy(
        req,
        process.env.APP_PROXY_SHARED_SECRET
      );
    } catch (err: any) {
      return json200({
        ok: false,
        error: "verify_throw",
        message: err?.message || String(err),
      });
    }

    if (!verified?.ok) {
      return json200({ ok: false, error: "unauthorized" });
    }

    /* =====================================================
       2) Lecture paramètres
       ===================================================== */
    const url = new URL(req.url);
    const productId = url.searchParams.get("productId");
    const customerId = verified.loggedInCustomerId;

    if (!productId || !customerId) {
      return json200({ ok: false, error: "missing_params" });
    }

    /* =====================================================
       3) Vérifier l'achat de l'élève (Prisma)
       ===================================================== */
    const purchase: any = await (prisma as any).studentCourse.findFirst({
      where: {
        shopifyCustomerId: String(customerId),
        archived: false,
        course: {
          shopifyProductId: String(productId), // ✅ STRING uniquement
        },
      },
      include: {
        course: true,
      },
    });

    if (!purchase || !purchase.course) {
      return json200({ ok: false, error: "not_allowed" });
    }

    /* =====================================================
       4) Récupérer l'URL du PDF (tolérant)
       ===================================================== */
    const pdfUrl =
      purchase.course.pdfUrl ||
      purchase.course.pdf_url ||
      purchase.course.pdfURL ||
      null;

    if (!pdfUrl) {
      return json200({ ok: false, error: "missing_pdf_url" });
    }

    /* =====================================================
       5) Redirection vers le PDF
       ===================================================== */
    return NextResponse.redirect(pdfUrl, 302);
  } catch (err: any) {
    return json200({
      ok: false,
      error: "server_error",
      message: err?.message || String(err),
    });
  }
}
