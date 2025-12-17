import { NextRequest, NextResponse } from "next/server";
import { verifyShopifyAppProxy } from "@/app/api/_lib/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!verifyShopifyAppProxy(req, process.env.APP_PROXY_SHARED_SECRET || "")
) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // Forward vers ton endpoint interne payouts summary
  const url = new URL(req.url);
  const email = url.searchParams.get("email") || "";
  const shopifyCustomerId = url.searchParams.get("shopifyCustomerId") || "";

  const base = `${url.protocol}//${url.host}`;
  const target = new URL("/api/payouts/summary", base);

  // IMPORTANT : ton /api/payouts/summary exige getTrainerFromRequest()
  // Donc on lui passe les headers attendus.
  const r = await fetch(target.toString(), {
    method: "GET",
    headers: {
      "x-trainer-id": shopifyCustomerId,
      "x-trainer-email": email,
    },
    cache: "no-store",
  });

  const txt = await r.text();
  return new NextResponse(txt, {
    status: r.status,
    headers: { "Content-Type": "application/json" },
  });
}
