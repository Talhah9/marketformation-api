// app/api/trainer/overview/route.ts
import { handleOptions, jsonWithCors } from "@/app/api/_lib/cors";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeText(v: any) {
  return String(v ?? "").trim();
}

function daysAgo(d: number) {
  const x = new Date();
  x.setDate(x.getDate() - d);
  return x;
}

function toTrainerId(args: { trainerId?: string; email?: string; shopifyCustomerId?: string }) {
  const tid = safeText(args.trainerId);
  if (tid) return tid;

  const sid = safeText(args.shopifyCustomerId);
  if (sid) return `trainer-${sid}`;

  const em = safeText(args.email).toLowerCase();
  if (em) return `email:${em}`;

  return "";
}

// Prisma Decimal -> number
function decToNumber(d: any) {
  if (d == null) return 0;
  const n = Number(String(d));
  return Number.isFinite(n) ? n : 0;
}

function eurLabel(n: number) {
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(2)} €`;
}

export async function OPTIONS(req: Request) {
  return handleOptions(req);
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    const resolvedTrainerId = toTrainerId({
      trainerId: url.searchParams.get("trainerId") || "",
      email: url.searchParams.get("email") || "",
      shopifyCustomerId: url.searchParams.get("shopifyCustomerId") || "",
    });

    if (!resolvedTrainerId) {
      return jsonWithCors(req, { ok: false, error: "trainerId_required" }, { status: 400 });
    }

    const since30 = daysAgo(30);

    const [summary, sales30] = await Promise.all([
      prisma.payoutsSummary.findUnique({
        where: { trainerId: resolvedTrainerId },
        select: { availableAmount: true, pendingAmount: true, currency: true, updatedAt: true },
      }),
      prisma.payoutsHistory.findMany({
        where: {
          trainerId: resolvedTrainerId,
          type: "sale",
          status: "available",
          date: { gte: since30 },
        },
        select: { amount: true },
      }),
    ]);

    const orders30d = sales30.length;
    const revenue30d = sales30.reduce((acc, r) => acc + decToNumber(r.amount), 0);

    const available = summary ? decToNumber(summary.availableAmount) : 0;
    const pending = summary ? decToNumber(summary.pendingAmount) : 0;
    const currency = safeText(summary?.currency || "EUR") || "EUR";

    return jsonWithCors(req, {
      ok: true,
      trainerId: resolvedTrainerId,
      currency,

      // KPIs (30j)
      orders_30d: orders30d,
      revenue_30d_eur: revenue30d,
      revenue_30d_label: currency === "EUR" ? eurLabel(revenue30d) : `${revenue30d.toFixed(2)} ${currency}`,

      // Solde
      available_eur: available,
      available_label: currency === "EUR" ? eurLabel(available) : `${available.toFixed(2)} ${currency}`,
      pending_eur: pending,
      pending_label: currency === "EUR" ? eurLabel(pending) : `${pending.toFixed(2)} ${currency}`,
      updatedAt: summary?.updatedAt || null,
    });
  } catch (e: any) {
    return jsonWithCors(req, { ok: false, error: e?.message || "trainer_overview_failed" }, { status: 500 });
  }
}
