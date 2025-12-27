// app/proxy/profile/route.ts
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

    if (!email && !shopifyCustomerId) {
      return NextResponse.json(
        { ok: false, error: "MISSING_EMAIL_OR_CUSTOMER_ID" },
        { status: 400 }
      );
    }

    // Forward interne vers /api/profile
    const internal = new URL("/api/profile", url.origin);
    if (email) internal.searchParams.set("email", email);
    if (shopifyCustomerId) internal.searchParams.set("shopifyCustomerId", shopifyCustomerId);

    const r = await fetch(internal.toString(), {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
    });

    const text = await r.text();
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
    return NextResponse.json(
      { ok: false, error: "PROXY_PROFILE_EXCEPTION", message: e?.message ?? "unknown" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
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

    // Forward interne vers /api/profile
    const internal = new URL("/api/profile", url.origin);

    const body = await req.json().catch(() => ({}));

    const r = await fetch(internal.toString(), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const text = await r.text();
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
    return NextResponse.json(
      { ok: false, error: "PROXY_PROFILE_EXCEPTION", message: e?.message ?? "unknown" },
      { status: 500 }
    );
  }
}
