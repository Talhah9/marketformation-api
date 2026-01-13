// app/api/stats/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    // Ici tu pourras plus tard brancher Stripe/Shopify/etc.
    // Pour l’instant on renvoie une structure stable attendue par le front.
    return NextResponse.json({
      ok: true,
      kpis: {
        revenue_30d: 0,
        visits_30d: 0,
        conversion_rate: 0,
        orders_30d: 0,
      },
      source: "stub",
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "STATS_ERROR" },
      { status: 500 }
    );
  }
}
