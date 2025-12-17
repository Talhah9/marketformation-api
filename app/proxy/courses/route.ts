// app/proxy/courses/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyShopifyAppProxy } from "@/app/api/_lib/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const sharedSecret = process.env.APP_PROXY_SHARED_SECRET;

    const verified = verifyShopifyAppProxy(req, sharedSecret);
    if (!verified.ok) {
      return NextResponse.json(
        { ok: false, error: "UNAUTHORIZED", reason: verified.reason },
        { status: 401 }
      );
    }

    const url = new URL(req.url);
    const email = url.searchParams.get("email") || "";
    const shopifyCustomerId = url.searchParams.get("shopifyCustomerId") || "";

    if (!email) {
      return NextResponse.json(
        { ok: false, error: "MISSING_EMAIL" },
        { status: 400 }
      );
    }

    // Sécurité: si le thème passe shopifyCustomerId, on exige la correspondance
    // avec logged_in_customer_id fourni par Shopify via l’App Proxy.
    const logged = verified.loggedInCustomerId ?? "";
    if (shopifyCustomerId && logged && shopifyCustomerId !== logged) {
      return NextResponse.json(
        {
          ok: false,
          error: "FORBIDDEN",
          reason: "CUSTOMER_MISMATCH",
          logged_in_customer_id: logged,
        },
        { status: 403 }
      );
    }

    // Forward interne vers /api/courses
    const internal = new URL("/api/courses", url.origin);
    internal.searchParams.set("email", email);

    const r = await fetch(internal.toString(), {
      method: "GET",
      headers: { "accept": "application/json" },
      cache: "no-store",
    });

    const text = await r.text();
    // On renvoie tel quel (JSON attendu), mais on protège si jamais ce n’est pas du JSON
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { ok: false, error: "UPSTREAM_NOT_JSON", status: r.status, body: text },
        { status: 502 }
      );
    }

    return NextResponse.json(data, { status: r.status });
  } catch (e: any) {
    // Dernier filet de sécurité → au lieu d’un 500 opaque
    return NextResponse.json(
      { ok: false, error: "PROXY_COURSES_EXCEPTION", message: e?.message ?? "unknown" },
      { status: 500 }
    );
  }
}
