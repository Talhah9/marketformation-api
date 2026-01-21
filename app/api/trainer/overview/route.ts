// app/api/trainer/overview/route.ts
import { handleOptions, jsonWithCors } from "@/app/api/_lib/cors";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function daysAgo(d: number) {
  const x = new Date();
  x.setDate(x.getDate() - d);
  return x;
}

export async function OPTIONS(req: Request) {
  return handleOptions(req);
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const trainerId = String(url.searchParams.get("trainerId") || "").trim();
    const trainerEmail = String(url.searchParams.get("email") || "").toLowerCase().trim();

    const resolvedTrainerId =
      trainerId ||
      (trainerEmail ? `email:${trainerEmail}` : "");

    if (!resolvedTrainerId) {
      return jsonWithCors(req, { ok: false, error: "trainerId_required" }, { status: 400 });
    }

    const since30 = daysAgo(30);

    const summary = await prisma.payoutsSummary.findUnique({
      where: { trainerId: resolvedTrainerId },
      select: { availableAmount: true, pendingAmount: true, currency: true, updatedAt: true },
    });

    const sales30 = await prisma.payoutsHistory.findMany({
      where: {
        trainerId: resolvedTrainerId,
        type: "sale",
        status: "available",
        date: { gte: since30 },
      },
      select: { amount: true },
    });

    const orders30d = sales30.length;
    const revenue30d = sales30.reduce((acc: number, r: any) => acc + Number(r.amount || 0), 0);

    return jsonWithCors(req, {
      ok: true,
      trainerId: resolvedTrainerId,
      currency: summary?.currency || "EUR",

      // KPIs (30j)
      orders_30d: orders30d,
      revenue_30d: revenue30d,

      // Solde
      available: summary ? Number(summary.availableAmount || 0) : 0,
      pending: summary ? Number(summary.pendingAmount || 0) : 0,
      updatedAt: summary?.updatedAt || null,
    });
  } catch (e: any) {
    return jsonWithCors(req, { ok: false, error: e?.message || "trainer_overview_failed" }, { status: 500 });
  }
}
