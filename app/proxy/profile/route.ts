// app/proxy/profile/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyShopifyAppProxy } from "@/app/api/_lib/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function pickHandle(url: URL) {
  return (url.searchParams.get("handle") || url.searchParams.get("u") || "").trim();
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

    const handle = pickHandle(url);
    const email = (url.searchParams.get("email") || "").trim();
    const shopifyCustomerId = (url.searchParams.get("shopifyCustomerId") || "").trim();
    const isPublic = url.searchParams.get("public") === "1";

    const logged = (verified.loggedInCustomerId ?? "").toString().trim();

    // ✅ Sécurité: en privé, si on fournit shopifyCustomerId, on vérifie mismatch
    // (en public, on ne force pas ça)
    if (!isPublic && shopifyCustomerId && logged && shopifyCustomerId !== logged) {
      return NextResponse.json(
        {
          ok: false,
          error: "FORBIDDEN",
          reason: "CUSTOMER_MISMATCH",
          logged_in_customer_id: logged,
          shopifyCustomerId,
        },
        { status: 403 }
      );
    }

    // ✅ Identité minimale
    // - public: handle (u=trainer-<id>) recommandé, mais on tolère email/customerId aussi
    // - privé: email ou customerId
    if (!handle && !email && !shopifyCustomerId) {
      return NextResponse.json(
        { ok: false, error: "MISSING_HANDLE_OR_PRIVATE_ID" },
        { status: 400 }
      );
    }

    // Forward interne vers /api/profile
    const internal = new URL("/api/profile", url.origin);

    if (handle) internal.searchParams.set("handle", handle);
    if (email) internal.searchParams.set("email", email);
    if (shopifyCustomerId) internal.searchParams.set("shopifyCustomerId", shopifyCustomerId);

    // forward flag (future-proof)
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

    const logged = (verified.loggedInCustomerId ?? "").toString().trim();

    const internal = new URL("/api/profile", new URL(req.url).origin);
    const body = await req.json().catch(() => ({}));

    // ✅ Optionnel mais utile: si le body contient shopifyCustomerId, on bloque mismatch
    const bodyAny: any = body?.profile && typeof body.profile === "object" ? body.profile : body;
    const shopifyCustomerId = String(bodyAny?.shopifyCustomerId || bodyAny?.customerId || "").trim();

    if (shopifyCustomerId && logged && shopifyCustomerId !== logged) {
      return NextResponse.json(
        {
          ok: false,
          error: "FORBIDDEN",
          reason: "CUSTOMER_MISMATCH",
          logged_in_customer_id: logged,
          shopifyCustomerId,
        },
        { status: 403 }
      );
    }

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
