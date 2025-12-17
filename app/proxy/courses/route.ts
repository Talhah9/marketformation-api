// app/proxy/courses/route.ts
import { NextRequest, NextResponse } from "next/server";
import { verifyShopifyAppProxy } from "@/app/api/_lib/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const secret = process.env.APP_PROXY_SHARED_SECRET || "";
    const ok = verifyShopifyAppProxy(req, secret);

    if (!ok) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);

    // on récupère l'email depuis la query (ton script l'envoie)
    const email = (url.searchParams.get("email") || "").trim();

    // ✅ IMPORTANT : si email absent => on renvoie vide (pas d'erreur 500)
    if (!email) {
      return NextResponse.json(
        { ok: true, items: [], plan: "Unknown", quota: null, warn: "missing_email" },
        { status: 200 }
      );
    }

    // Appel interne vers /api/courses (même app, même déploiement)
    const origin = `${url.protocol}//${url.host}`;
    const target = new URL("/api/courses", origin);
    target.searchParams.set("email", email);

    const r = await fetch(target.toString(), { cache: "no-store" });
    const text = await r.text();

    // On renvoie tel quel (json) sans casser
    return new NextResponse(text, {
      status: r.status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "proxy_courses_failed", detail: e?.message || String(e) },
      { status: 500 }
    );
  }
}
