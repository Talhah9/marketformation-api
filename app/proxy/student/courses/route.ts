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

    const u = new URL(req.url);
    const email = u.searchParams.get("email") || "";
    const shopifyCustomerId = u.searchParams.get("shopifyCustomerId") || "";

    if (!email && !shopifyCustomerId) {
      return NextResponse.json(
        { ok: false, error: "email_or_customerId_required" },
        { status: 400 }
      );
    }

    // ✅ Forward interne vers l’API Prisma
    const internal = new URL("/api/student/courses", u.origin);
    if (email) internal.searchParams.set("email", email);
    if (shopifyCustomerId) internal.searchParams.set("shopifyCustomerId", shopifyCustomerId);

    const r = await fetch(internal.toString(), {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
    });

    const text = await r.text();

    // Si l’API interne plante, on renvoie le body brut pour debug
    if (!r.ok) {
      console.error("[MF] /api/student/courses upstream error:", r.status, text);
      return NextResponse.json(
        { ok: false, error: "UPSTREAM_ERROR", status: r.status, body: text },
        { status: 502 }
      );
    }

    // Renvoi JSON normal
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      console.error("[MF] upstream not json:", text);
      return NextResponse.json(
        { ok: false, error: "UPSTREAM_NOT_JSON", body: text },
        { status: 502 }
      );
    }

    return NextResponse.json(data, { status: 200 });
  } catch (e: any) {
    console.error("[MF] proxy/student/courses exception:", e);
    return NextResponse.json(
      { ok: false, error: "PROXY_EXCEPTION", message: e?.message || "unknown" },
      { status: 500 }
    );
  }
}
