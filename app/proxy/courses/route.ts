// app/proxy/courses/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyShopifyAppProxy } from "@/app/api/_lib/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getHandleFromUrl(url: URL) {
  return (
    (url.searchParams.get("handle") || "").trim() ||
    (url.searchParams.get("u") || "").trim() ||
    ""
  );
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
    const email = (url.searchParams.get("email") || "").trim();
    const shopifyCustomerId = (url.searchParams.get("shopifyCustomerId") || "").trim();
    const handle = getHandleFromUrl(url);

    const logged = (verified.loggedInCustomerId ?? "").toString();

    // ==========================================================
    // MODE PUBLIC: handle présent => pas besoin d'email/login
    // ==========================================================
    const isPublic = !!handle;

    // ==========================================================
    // MODE PRIVÉ: on exige email, et on check mismatch si ID fourni
    // ==========================================================
    if (!isPublic) {
      if (!email) {
        return NextResponse.json({ ok: false, error: "MISSING_EMAIL" }, { status: 400 });
      }

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
    }

    // Forward interne vers /api/courses
    const internal = new URL("/api/courses", url.origin);

    if (isPublic) {
      internal.searchParams.set("handle", handle); // ✅ on laisse /api/courses résoudre le handle
      internal.searchParams.set("public", "1");    // ✅ /api/courses filtrera published uniquement
    } else {
      internal.searchParams.set("email", email);
      // utile pour quota côté /api/courses
      if (shopifyCustomerId) internal.searchParams.set("shopifyCustomerId", shopifyCustomerId);
    }

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
