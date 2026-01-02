// app/proxy/courses/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyShopifyAppProxy } from "@/app/api/_lib/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function pickHandle(url: URL) {
  return (
    (url.searchParams.get("u") || "").trim() ||
    (url.searchParams.get("handle") || "").trim() ||
    ""
  );
}

function isTrainerHandle(h: string) {
  return /^trainer-\d+$/i.test(String(h || "").trim());
}

function digitsFromTrainerHandle(h: string) {
  const m = String(h || "").trim().match(/^trainer-(\d+)$/i);
  return m ? m[1] : "";
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

    // Incoming params
    const email = (url.searchParams.get("email") || "").trim();
    const shopifyCustomerIdParam = (url.searchParams.get("shopifyCustomerId") || "").trim();
    const handle = pickHandle(url);

    // Verified logged-in customer id from App Proxy signature
    const logged = (verified.loggedInCustomerId ?? "").toString().trim();

    // ✅ Public mode ONLY if explicitly requested
    const isPublic = url.searchParams.get("public") === "1";

    // ✅ Choose stable private identity
    // - Prefer verified logged id
    // - Else allow explicit shopifyCustomerId
    // - Else (public only) allow trainer-handle to derive numeric id
    const derivedFromHandle = isTrainerHandle(handle) ? digitsFromTrainerHandle(handle) : "";
    const shopifyCustomerId =
      (logged || shopifyCustomerIdParam || (isPublic ? derivedFromHandle : "") || "").trim();

    // ✅ For private mode, if a shopifyCustomerId is provided and doesn't match logged, forbid
    if (!isPublic && shopifyCustomerIdParam && logged && shopifyCustomerIdParam !== logged) {
      return NextResponse.json(
        {
          ok: false,
          error: "FORBIDDEN",
          reason: "CUSTOMER_MISMATCH",
          logged_in_customer_id: logged,
          shopifyCustomerId: shopifyCustomerIdParam,
        },
        { status: 403 }
      );
    }

    // ✅ Require at least one identity
    // - Private: need logged/shopifyCustomerId or email
    // - Public: need handle/u or derived id
    const hasAnyIdentity = !!shopifyCustomerId || !!email || !!handle;
    if (!hasAnyIdentity) {
      return NextResponse.json(
        { ok: false, error: "MISSING_IDENTITY", reason: "NEED_email_OR_shopifyCustomerId_OR_u_handle" },
        { status: 400 }
      );
    }

    // Forward to internal API
    const internal = new URL("/api/courses", url.origin);

    // Always forward stable ids if present
    if (shopifyCustomerId) internal.searchParams.set("shopifyCustomerId", shopifyCustomerId);
    if (email) internal.searchParams.set("email", email);

    // Forward handle/u if present (tolerance)
    if (handle) {
      internal.searchParams.set("u", handle);
      internal.searchParams.set("handle", handle);
    }

    // Public flag only if explicitly asked
    if (isPublic) internal.searchParams.set("public", "1");

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
      { ok: false, error: "PROXY_COURSES_EXCEPTION", message: e?.message ?? "unknown" },
      { status: 500 }
    );
  }
}
