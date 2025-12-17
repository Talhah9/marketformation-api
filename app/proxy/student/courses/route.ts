// app/proxy/student/courses/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyShopifyAppProxy } from "@/app/api/_lib/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const verified = verifyShopifyAppProxy(req, process.env.APP_PROXY_SHARED_SECRET);
    if (!verified.ok) {
      return NextResponse.json(
        { ok: false, error: "UNAUTHORIZED", reason: verified.reason },
        { status: 401 }
      );
    }

    const url = new URL(req.url);
    const email = url.searchParams.get("email") || "";
    const shopifyCustomerId = url.searchParams.get("shopifyCustomerId") || "";

    if (!email && !shopifyCustomerId) {
      return NextResponse.json(
        { ok: false, error: "email_or_customerId_required" },
        { status: 400 }
      );
    }

    // Option sécurité : si Shopify fournit logged_in_customer_id, on force la cohérence
    const logged = verified.loggedInCustomerId || "";
    if (shopifyCustomerId && logged && shopifyCustomerId !== logged) {
      return NextResponse.json(
        { ok: false, error: "FORBIDDEN", reason: "CUSTOMER_MISMATCH" },
        { status: 403 }
      );
    }

    const internal = new URL("/api/student/courses", url.origin);
    if (email) internal.searchParams.set("email", email);
    if (shopifyCustomerId) internal.searchParams.set("shopifyCustomerId", shopifyCustomerId);

    const r = await fetch(internal.toString(), {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
    });

    const text = await r.text();
    let data: any;
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
    return NextResponse.json(
      { ok: false, error: "PROXY_STUDENT_COURSES_EXCEPTION", message: e?.message || "unknown" },
      { status: 500 }
    );
  }
}
