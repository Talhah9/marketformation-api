// app/proxy/stats/route.ts
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  try {
    // ✅ pour l’instant : valeurs par défaut (backend réel plus tard)
    // on garde la signature attendue par le front
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
      { ok: false, error: e?.message || "stats_error" },
      { status: 500 }
    );
  }
}
