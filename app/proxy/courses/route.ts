import { NextRequest, NextResponse } from "next/server";
import { verifyShopifyAppProxy } from "@/app/api/_lib/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!verifyShopifyAppProxy(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // On forward vers la vraie API interne (celle qui parle à Shopify admin)
  const url = new URL(req.url);
  const email = url.searchParams.get("email") || "";
  const shopifyCustomerId = url.searchParams.get("shopifyCustomerId") || "";

  const base = `${url.protocol}//${url.host}`;
  const target = new URL("/api/courses", base);
  if (email) target.searchParams.set("email", email);
  if (shopifyCustomerId) target.searchParams.set("shopifyCustomerId", shopifyCustomerId);

  const r = await fetch(target.toString(), { cache: "no-store" });
  const txt = await r.text();
  return new NextResponse(txt, {
    status: r.status,
    headers: { "Content-Type": "application/json" },
  });
}
