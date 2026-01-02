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

function isTrainerHandle(h: string) {
  return /^trainer-\d+$/i.test(String(h || "").trim());
}

function digitsFromTrainerHandle(h: string) {
  const m = String(h || "").match(/^trainer-(\d+)$/i);
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
    const email = (url.searchParams.get("email") || "").trim();
    const shopifyCustomerIdRaw = (url.searchParams.get("shopifyCustomerId") || "").trim();
    const handle = getHandleFromUrl(url);

    const logged = (verified.loggedInCustomerId ?? "").toString().trim();

    // ✅ PRIVATE si l'utilisateur est connecté (logged) OU si email/shopifyCustomerId existent.
    // On ne bascule PUBLIC que si on a un handle ET qu'il n'y a PAS de login.
    const hasPrivateIdentity = !!logged || !!email || !!shopifyCustomerIdRaw;
    const isPublic = !!handle && !hasPrivateIdentity;

    // ✅ Identité privée stable: on privilégie logged, sinon shopifyCustomerId
    const shopifyCustomerId = logged || shopifyCustomerIdRaw;

    // ==========================================================
    // MODE PRIVÉ: on exige au moins logged OU email
    // ==========================================================
    if (!isPublic) {
      if (!shopifyCustomerId && !email) {
        return NextResponse.json(
          { ok: false, error: "MISSING_IDENTITY", reason: "NEED_LOGGED_OR_EMAIL" },
          { status: 400 }
        );
      }

      // mismatch check uniquement si on a les deux
      if (shopifyCustomerIdRaw && logged && shopifyCustomerIdRaw !== logged) {
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
      // ✅ Public: on envoie handle + u + shopifyCustomerId si déductible
      const h = String(handle || "").trim();
      internal.searchParams.set("public", "1");
      internal.searchParams.set("handle", h);
      internal.searchParams.set("u", h);

      if (isTrainerHandle(h)) {
        const digits = digitsFromTrainerHandle(h);
        if (digits) internal.searchParams.set("shopifyCustomerId", digits);
      }
    } else {
      // ✅ Privé: on privilégie shopifyCustomerId (stable)
      if (shopifyCustomerId) internal.searchParams.set("shopifyCustomerId", shopifyCustomerId);
      if (email) internal.searchParams.set("email", email);

      // Tolérance si ton /api/courses sait aussi résoudre par handle/u
      if (handle) {
        internal.searchParams.set("handle", handle);
        internal.searchParams.set("u", handle);
      }
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
