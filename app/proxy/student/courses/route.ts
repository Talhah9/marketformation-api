// app/proxy/student/courses/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyShopifyAppProxy } from "@/app/api/_lib/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(payload: any) {
  return NextResponse.json(payload, {
    status: 200, // IMPORTANT: toujours 200 sinon Shopify page d'erreur
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(req: NextRequest) {
  try {
    let verified: any;
    try {
      verified = verifyShopifyAppProxy(req, process.env.APP_PROXY_SHARED_SECRET);
    } catch (e: any) {
      return json({ ok: false, step: "verify_throw", message: e?.message || String(e) });
    }

    if (!verified?.ok) {
      return json({ ok: false, step: "verify_failed", verified });
    }

    const u = new URL(req.url);
    const email = u.searchParams.get("email") || "";
    const shopifyCustomerId = u.searchParams.get("shopifyCustomerId") || "";

    if (!email && !shopifyCustomerId) {
      return json({ ok: false, step: "params", error: "email_or_customerId_required" });
    }

    const logged = verified.loggedInCustomerId || "";
    if (shopifyCustomerId && logged && shopifyCustomerId !== logged) {
      return json({
        ok: false,
        step: "customer_mismatch",
        shopifyCustomerId,
        loggedInCustomerId: logged,
      });
    }

    // ✅ IMPORTANT : appeler le backend Vercel, pas le domaine Shopify
    const API_BASE = process.env.API_BASE_URL || "https://mf-api-gold-topaz.vercel.app";
    const internal = new URL("/api/student/courses", API_BASE);
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
      return json({
        ok: false,
        step: "fetch_internal_throw",
        internal: internal.toString(),
        message: e?.message || String(e),
      });
    }

    const text = await r.text().catch(() => "");

    // Si OK, on renvoie la réponse JSON telle quelle (pas de wrapper)
    if (r.ok) {
      try {
        const data = JSON.parse(text);
        return NextResponse.json(data, {
          status: 200,
          headers: { "Cache-Control": "no-store" },
        });
      } catch {
        return json({ ok: false, step: "upstream_not_json", upstreamBody: text });
      }
    }

    // Sinon on garde le debug
    return json({
      ok: false,
      step: "upstream",
      upstreamStatus: r.status,
      upstreamBody: text,
      internal: internal.toString(),
    });
  } catch (e: any) {
    return json({ ok: false, step: "proxy_catch", message: e?.message || String(e) });
  }
}
