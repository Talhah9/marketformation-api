// app/proxy/profile/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyShopifyAppProxy } from "@/app/api/_lib/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonUpstream(text: string, status: number) {
  try {
    const data = JSON.parse(text);
    return NextResponse.json(data, { status });
  } catch {
    return NextResponse.json(
      { ok: false, error: "UPSTREAM_NOT_JSON", status, body: text },
      { status: 502 }
    );
  }
}

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

    // ✅ NEW: public identity via handle
    const handle = (url.searchParams.get("handle") || url.searchParams.get("u") || "").trim();

    // legacy/private identity
    const email = (url.searchParams.get("email") || "").trim();
    const shopifyCustomerId = (url.searchParams.get("shopifyCustomerId") || "").trim();

    // Forward interne vers /api/profile
    const internal = new URL("/api/profile", url.origin);

    // ✅ Public path: prefer handle if present
    if (handle) {
      internal.searchParams.set("handle", handle);
    } else {
      // Private path: requires email or customerId
      if (!email && !shopifyCustomerId) {
        return NextResponse.json(
          { ok: false, error: "MISSING_HANDLE_OR_EMAIL_OR_CUSTOMER_ID" },
          { status: 400 }
        );
      }
      if (email) internal.searchParams.set("email", email);
      if (shopifyCustomerId) internal.searchParams.set("shopifyCustomerId", shopifyCustomerId);
    }

    const r = await fetch(internal.toString(), {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
    });

    const text = await r.text();
    return jsonUpstream(text, r.status);
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
    const internal = new URL("/api/profile", url.origin);

    const body = await req.json().catch(() => ({}));

    // ✅ Guard: POST must stay private (we need an identity in body)
    const bodyEmail = String(body?.email || "").trim();
    const bodyCustomerId = String(body?.shopifyCustomerId || "").trim();
    if (!bodyEmail && !bodyCustomerId) {
      return NextResponse.json(
        { ok: false, error: "MISSING_IDENTITY_IN_BODY" },
        { status: 400 }
      );
    }

    const r = await fetch(internal.toString(), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const text = await r.text();
    return jsonUpstream(text, r.status);
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "PROXY_PROFILE_EXCEPTION", message: e?.message ?? "unknown" },
      { status: 500 }
    );
  }
}
