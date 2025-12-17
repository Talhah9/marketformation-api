// app/proxy/student/courses/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyShopifyAppProxy } from "@/app/api/_lib/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Shopify App Proxy :
 * ⚠️ DOIT TOUJOURS répondre en 200
 * sinon Shopify affiche "There was an error in the third-party application"
 */
function json200(payload: any) {
  return NextResponse.json(payload, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    },
  });
}

export async function GET(req: NextRequest) {
  try {
    /* =====================================================
       1) Vérification App Proxy Shopify (HMAC)
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
        step: "verify_throw",
        message: err?.message || String(err),
      });
    }

    if (!verified?.ok) {
      return json200({
        ok: false,
        step: "verify_failed",
        verified,
      });
    }

    /* =====================================================
       2) Lecture des paramètres
       ===================================================== */
    const url = new URL(req.url);
    const email = url.searchParams.get("email") || "";
    const shopifyCustomerId =
      url.searchParams.get("shopifyCustomerId") || "";

    if (!email && !shopifyCustomerId) {
      return json200({
        ok: false,
        step: "params_missing",
        error: "email_or_shopifyCustomerId_required",
      });
    }

    /* =====================================================
       3) Sécurité : cohérence client connecté Shopify
       ===================================================== */
    const loggedInCustomerId = verified.loggedInCustomerId || "";
    if (
      shopifyCustomerId &&
      loggedInCustomerId &&
      shopifyCustomerId !== loggedInCustomerId
    ) {
      return json200({
        ok: false,
        step: "customer_mismatch",
        shopifyCustomerId,
        loggedInCustomerId,
      });
    }

    /* =====================================================
       4) Appel du BACKEND VERCEL (PAS le domaine Shopify)
       ===================================================== */
    const API_BASE =
      process.env.API_BASE_URL ||
      "https://mf-api-gold-topaz.vercel.app";

    const internal = new URL("/api/student/courses", API_BASE);
    if (email) internal.searchParams.set("email", email);
    if (shopifyCustomerId) {
      internal.searchParams.set(
        "shopifyCustomerId",
        shopifyCustomerId
      );
    }

    let response: Response;
    try {
      response = await fetch(internal.toString(), {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        cache: "no-store",
      });
    } catch (err: any) {
      return json200({
        ok: false,
        step: "fetch_internal_throw",
        internal: internal.toString(),
        message: err?.message || String(err),
      });
    }

    const raw = await response.text().catch(() => "");

    /* =====================================================
       5) Succès : on renvoie TEL QUEL le JSON upstream
       ===================================================== */
    if (response.ok) {
      try {
        const data = JSON.parse(raw);
        return NextResponse.json(data, {
          status: 200,
          headers: { "Cache-Control": "no-store" },
        });
      } catch (err: any) {
        return json200({
          ok: false,
          step: "upstream_not_json",
          internal: internal.toString(),
          raw,
        });
      }
    }

    /* =====================================================
       6) Erreur upstream (Prisma, DB, etc.)
       ===================================================== */
    return json200({
      ok: false,
      step: "upstream_error",
      internal: internal.toString(),
      upstreamStatus: response.status,
      upstreamBody: raw,
    });
  } catch (err: any) {
    /* =====================================================
       7) Catch final (ne doit JAMAIS arriver)
       ===================================================== */
    return json200({
      ok: false,
      step: "proxy_catch",
      message: err?.message || String(err),
    });
  }
}
