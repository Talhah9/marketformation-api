import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyShopifyAppProxy } from "@/app/api/_lib/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ok200(payload: any) {
  // Shopify App Proxy affiche sa page d'erreur dès qu'on sort du 200
  return NextResponse.json(payload, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(req: NextRequest) {
  try {
    // 1) Vérif App Proxy (NE DOIT JAMAIS throw)
    let verified: any;
    try {
      verified = verifyShopifyAppProxy(req, process.env.APP_PROXY_SHARED_SECRET);
    } catch (e: any) {
      return ok200({
        ok: false,
        step: "verify_throw",
        message: e?.message || String(e),
      });
    }

    if (!verified?.ok) {
      return ok200({
        ok: false,
        step: "verify_failed",
        verified,
      });
    }

    // 2) Params
    const u = new URL(req.url);
    const email = u.searchParams.get("email") || "";
    const shopifyCustomerId = u.searchParams.get("shopifyCustomerId") || "";

    if (!email && !shopifyCustomerId) {
      return ok200({
        ok: false,
        step: "params",
        error: "email_or_customerId_required",
      });
    }

    // (Optionnel sécurité) si Shopify fournit logged_in_customer_id, on bloque mismatch
    const logged = verified.loggedInCustomerId || "";
    if (shopifyCustomerId && logged && shopifyCustomerId !== logged) {
      return ok200({
        ok: false,
        step: "customer_mismatch",
        shopifyCustomerId,
        loggedInCustomerId: logged,
      });
    }

    // 3) Forward vers l’API interne Prisma
    const internal = new URL("/api/student/courses", u.origin);
    if (email) internal.searchParams.set("email", email);
    if (shopifyCustomerId) internal.searchParams.set("shopifyCustomerId", shopifyCustomerId);

    let r: Response;
    try {
      r = await fetch(internal.toString(), {
        method: "GET",
        headers: { accept: "application/json" },
        cache: "no-store",
      });
    } catch (e: any) {
      return ok200({
        ok: false,
        step: "fetch_internal_throw",
        message: e?.message || String(e),
        internal: internal.toString(),
      });
    }

    const text = await r.text().catch(() => "");
    // On renvoie TOUJOURS 200, et on met le statut upstream dans le JSON
    return ok200({
      ok: r.ok,
      step: "upstream",
      upstreamStatus: r.status,
      upstreamBody: text,
    });
  } catch (e: any) {
    return ok200({
      ok: false,
      step: "proxy_catch",
      message: e?.message || String(e),
    });
  }
}
