import { NextRequest, NextResponse } from "next/server";
import { verifyShopifyAppProxy } from "@/app/api/_lib/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ok = verifyShopifyAppProxy(req);
  return NextResponse.json(
    { ok, pong: true, ts: Date.now() },
    { status: ok ? 200 : 401 }
  );
}
