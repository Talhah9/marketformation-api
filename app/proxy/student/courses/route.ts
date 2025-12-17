import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyShopifyAppProxy } from "@/app/api/_lib/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    console.log("[MF] proxy/student/courses HIT");

    const verified = verifyShopifyAppProxy(req, process.env.APP_PROXY_SHARED_SECRET);
    console.log("[MF] proxy verify:", verified);

    if (!verified.ok) {
      return NextResponse.json(
        { ok: false, step: "verify", verified },
        { status: 401 }
      );
    }

    const u = new URL(req.url);
    const email = u.searchParams.get("email");
    const shopifyCustomerId = u.searchParams.get("shopifyCustomerId");

    console.log("[MF] params:", { email, shopifyCustomerId });

    const internal = new URL("/api/student/courses", u.origin);
    if (email) internal.searchParams.set("email", email);
    if (shopifyCustomerId) internal.searchParams.set("shopifyCustomerId", shopifyCustomerId);

    console.log("[MF] forward to:", internal.toString());

    const r = await fetch(internal.toString(), {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
    });

    const text = await r.text();
    console.log("[MF] upstream status:", r.status);
    console.log("[MF] upstream body:", text);

    return NextResponse.json(
      {
        ok: r.ok,
        upstreamStatus: r.status,
        body: text
      },
      { status: r.ok ? 200 : 500 }
    );

  } catch (e: any) {
    console.error("[MF] proxy exception:", e);
    return NextResponse.json(
      { ok: false, step: "catch", message: e?.message || "unknown" },
      { status: 500 }
    );
  }
}
