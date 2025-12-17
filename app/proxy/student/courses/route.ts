// app/proxy/student/courses/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyShopifyAppProxy } from "@/app/api/_lib/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(payload: any, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(req: NextRequest) {
  try {
    // 1) Vérif App Proxy (ne doit JAMAIS throw)
    let verified: any;
    try {
      verified = verifyShopifyAppProxy(req, process.env.APP_PROXY_SHARED_SECRET);
    } catch (e: any) {
      return json({ ok: false, step: "verify_throw", message: e?.message || String(e) }, 200);
    }

    if (!verified?.ok) {
      return json({ ok: false, step: "verify_failed", verified }, 200);
    }

    // 2) Params
    const u = new URL(req.url);
    const email = u.searchParams.get("email") || "";
    const shopifyCustomerId = u.searchParams.get("shopifyCustomerId") || "";

    if (!email && !shopifyCustomerId) {
      return json({ ok: false, step: "params", error: "email_or_customerId_required" }, 200);
    }

    // Option sécurité : si Shopify fournit logged_in_customer_id, on vérifie cohérence
    const logged = verified.loggedInCustomerId || "";
    if (shopifyCustomerId && logged && shopifyCustomerId !== logged) {
      return json(
        { ok: false, step: "customer_mismatch", shopifyCustomerId, loggedInCustomerId: logged },
        200
      );
    }

    // 3) Forward interne vers l’API Prisma (même déploiement)
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
      return json(
        {
          ok: false,
          step: "fetch_internal_throw",
          internal: internal.toString(),
          message: e?.message || String(e),
        },
        200
      );
    }

    const text = await r.text().catch(() => "");

    // On renvoie TOUJOURS 200 côté proxy (sinon Shopify met sa page générique / ton front masque)
    return json(
      {
        ok: r.ok,
        step: "upstream",
        upstreamStatus: r.status,
        upstreamBody: text,
      },
      200
    );
  } catch (e: any) {
    return json({ ok: false, step: "proxy_catch", message: e?.message || String(e) }, 200);
  }
}
