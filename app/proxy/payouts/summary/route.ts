// app/api/payouts/summary/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTrainerFromRequest } from "@/lib/authTrainer";
import { verifyShopifyAppProxy } from "@/app/api/_lib/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function withCors(res: NextResponse, req: NextRequest) {
  const origin = req.headers.get("origin") || "*";

  res.headers.set("Access-Control-Allow-Origin", origin);
  res.headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.headers.set(
    "Access-Control-Allow-Headers",
    "Origin, Accept, Content-Type, Authorization, X-Requested-With, x-trainer-id, x-trainer-email"
  );
  res.headers.set("Access-Control-Allow-Credentials", "true");
  res.headers.set("Vary", "Origin");

  return res;
}

export async function OPTIONS(req: NextRequest) {
  const res = new NextResponse(null, { status: 204 });
  return withCors(res, req);
}

// Petit helper pour masquer l’IBAN côté front
function maskIban(iban: string | null | undefined): string | null {
  if (!iban) return null;
  const clean = iban.replace(/\s+/g, "");
  if (clean.length <= 8) return "•••• " + clean.slice(-4);
  return clean.slice(0, 4) + " •• •• •• " + clean.slice(-4);
}

type Ctx = { trainerId: string; email?: string | null };

/**
 * Supporte 2 modes :
 * 1) App Proxy Shopify: /apps/mf/payouts/summary?email=...&shopifyCustomerId=...
 *    -> Shopify signe la requête, on vérifie via APP_PROXY_SHARED_SECRET.
 * 2) App “directe” (API Vercel): auth via getTrainerFromRequest(req) (cookies/headers).
 */
function getCtx(req: NextRequest): { ctx: Ctx | null; mode: "proxy" | "direct" | "none" } {
  const url = req.nextUrl;

  const email = url.searchParams.get("email");
  const shopifyCustomerId =
    url.searchParams.get("shopifyCustomerId") || url.searchParams.get("customerId");

  // Mode App Proxy si query présente
  if (shopifyCustomerId || email) {
    const secret = process.env.APP_PROXY_SHARED_SECRET || "";
    const ok = verifyShopifyAppProxy(req, secret);

    if (!ok) return { ctx: null, mode: "proxy" };

    // Ici on choisit trainerId = shopifyCustomerId (c’est ce que tu passes depuis Liquid)
    if (!shopifyCustomerId) return { ctx: null, mode: "proxy" };

    return {
      ctx: { trainerId: String(shopifyCustomerId), email: email ? String(email) : null },
      mode: "proxy",
    };
  }

  // Mode direct (ancienne méthode)
  const direct = getTrainerFromRequest(req);
  if (!direct || !direct.trainerId) return { ctx: null, mode: "none" };

  return {
    ctx: { trainerId: String(direct.trainerId), email: direct.email ?? null },
    mode: "direct",
  };
}

export async function GET(req: NextRequest) {
  try {
    const { ctx, mode } = getCtx(req);

    if (!ctx?.trainerId) {
      const res = NextResponse.json(
        { ok: false, error: "unauthorized", mode },
        { status: 401 }
      );
      return withCors(res, req);
    }

    const { trainerId, email } = ctx;

    // 1) On s’assure qu’un enregistrement TrainerBanking existe
    const banking = await prisma.trainerBanking.upsert({
      where: { trainerId },
      update: {
        email: email ?? undefined,
      },
      create: {
        trainerId,
        email: email ?? null,
      },
    });

    // 2) Résumé des paiements
    const summary = await prisma.payoutsSummary.upsert({
      where: { trainerId },
      update: {},
      create: {
        trainerId,
        availableAmount: 0,
        pendingAmount: 0,
        currency: "EUR",
      },
    });

    // 3) Historique (les 20 derniers)
    const history = await prisma.payoutsHistory.findMany({
      where: { trainerId },
      orderBy: { date: "desc" },
      take: 20,
    });

    const historyPayload = history.map((item) => ({
      id: item.id,
      type: item.type,
      status: item.status,
      amount: Number(item.amount),
      currency: item.currency,
      date: item.date.toISOString(),
      date_label: item.date.toLocaleDateString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }),
      meta: item.meta ?? null,
    }));

    const res = NextResponse.json(
      {
        ok: true,
        mode,
        currency: summary.currency,
        available: Number(summary.availableAmount),
        pending: Number(summary.pendingAmount),
        min_payout: 50,
        has_banking: !!banking.payoutIban,
        auto_payout: banking.autoPayout,
        banking: {
          payout_name: banking.payoutName,
          payout_country: banking.payoutCountry,
          payout_iban_masked: maskIban(banking.payoutIban),
          payout_bic: banking.payoutBic,
        },
        history: historyPayload,
      },
      { status: 200 }
    );

    return withCors(res, req);
  } catch (err) {
    console.error("[MF] /api/payouts/summary GET error", err);
    const res = NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
    return withCors(res, req);
  }
}
