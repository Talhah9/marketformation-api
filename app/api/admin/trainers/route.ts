// app/api/admin/trainers/route.ts
import { handleOptions, jsonWithCors } from "@/app/api/_lib/cors";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAdminReq(req: Request) {
  const email = (req.headers.get("x-mf-admin-email") || "").toLowerCase().trim();
  const allow = (process.env.MF_ADMIN_EMAILS || "talhahally974@gmail.com")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return !!email && allow.includes(email);
}

function safeText(v: any) {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

function numFromDecimal(d: any) {
  // Prisma Decimal -> string la plupart du temps
  if (d == null) return 0;
  const n = Number(String(d));
  return Number.isFinite(n) ? n : 0;
}

function eurLabel(n: number) {
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(2)} €`;
}

function trainerIdFrom(obj: { trainerShopifyId?: string | null; trainerEmail?: string | null }) {
  const sid = safeText(obj?.trainerShopifyId);
  if (sid) return `trainer-${sid}`;

  const em = safeText(obj?.trainerEmail).toLowerCase();
  if (em) return `email:${em}`;

  return "";
}

export async function OPTIONS(req: Request) {
  return handleOptions(req);
}

export async function GET(req: Request) {
  try {
    if (!isAdminReq(req)) {
      return jsonWithCors(req, { ok: false, error: "admin_forbidden" }, { status: 403 });
    }

    // 1) Sources formateurs:
    // - depuis les courses (distinct trainerEmail / trainerShopifyId)
    // - depuis TrainerBanking (si un trainer n’a pas encore de course, il apparaît quand même)
    const [coursesTrainers, bankings] = await Promise.all([
      prisma.course.findMany({
        where: {
          OR: [{ trainerEmail: { not: null } }, { trainerShopifyId: { not: null } }],
        },
        select: {
          trainerEmail: true,
          trainerShopifyId: true,
        },
      }),
      prisma.trainerBanking.findMany({
        select: {
          trainerId: true,
          email: true,
          payoutName: true,
          payoutIban: true,
        },
      }),
    ]);

    // map trainerId -> base profile
    const map = new Map<
      string,
      {
        trainerId: string;
        email: string;
        name: string;
        hasIban: boolean;
        ibanLast4: string;
      }
    >();

    // A) depuis courses
    for (const t of coursesTrainers) {
      const tid = trainerIdFrom(t);
      if (!tid) continue;

      const email =
        safeText(t.trainerEmail).toLowerCase() ||
        (tid.startsWith("email:") ? tid.slice(6) : "") ||
        "";

      if (!map.has(tid)) {
        map.set(tid, {
          trainerId: tid,
          email,
          name: email || "—",
          hasIban: false,
          ibanLast4: "",
        });
      }
    }

    // B) depuis banking (prioritaire sur nom/email/iban)
    for (const b of bankings) {
      const tid = safeText(b.trainerId);
      if (!tid) continue;

      const email = safeText(b.email).toLowerCase() || (tid.startsWith("email:") ? tid.slice(6) : "");
      const name = safeText(b.payoutName) || email || tid;

      const ibanRaw = safeText(b.payoutIban);
      const ibanLast4 = ibanRaw ? ibanRaw.replace(/\s+/g, "").slice(-4) : "";

      const prev = map.get(tid);
      map.set(tid, {
        trainerId: tid,
        email: email || prev?.email || "",
        name: name || prev?.name || "—",
        hasIban: !!ibanRaw,
        ibanLast4: ibanLast4 || prev?.ibanLast4 || "",
      });
    }

    const trainerIds = Array.from(map.keys());
    if (!trainerIds.length) {
      return jsonWithCors(req, { ok: true, items: [] });
    }

    // 2) Gains: depuis PayoutsSummary
    const summaries = await prisma.payoutsSummary.findMany({
      where: { trainerId: { in: trainerIds } },
      select: { trainerId: true, availableAmount: true, pendingAmount: true, currency: true },
    });

    const sumMap = new Map<string, { available: number; pending: number; currency: string }>();
    for (const s of summaries) {
      sumMap.set(s.trainerId, {
        available: numFromDecimal(s.availableAmount),
        pending: numFromDecimal(s.pendingAmount),
        currency: safeText(s.currency || "EUR") || "EUR",
      });
    }

    // 3) Sortie shape compatible avec ton front admin
    const items = trainerIds
      .map((tid) => {
        const base = map.get(tid)!;
        const s = sumMap.get(tid);

        const available = s ? s.available : 0;
        const pending = s ? s.pending : 0;

        // "gains cumulés" -> total = available + pending (comme tu faisais)
        const total = available + pending;

        return {
          // ✅ debug / futur actions
          trainerId: base.trainerId,

          name: base.name || "—",
          email: base.email || "—",

          // Plan: MVP (tu brancheras Stripe ensuite)
          plan: "—",
          plan_label: "—",

          gains_eur: total,
          gains_label: eurLabel(total),

          // ✅ ton front utilise has_iban
          has_iban: !!base.hasIban,

          // ✅ bonus non-cassant
          iban_last4: base.ibanLast4 ? `**** ${base.ibanLast4}` : "",
          available_eur: available,
          pending_eur: pending,
          available_label: eurLabel(available),
          pending_label: eurLabel(pending),
          currency: s?.currency || "EUR",
        };
      })
      // tri stable: gains desc puis email
      .sort(
        (a, b) =>
          (b.gains_eur || 0) - (a.gains_eur || 0) || String(a.email).localeCompare(String(b.email))
      );

    return jsonWithCors(req, { ok: true, items });
  } catch (e: any) {
    return jsonWithCors(req, { ok: false, error: e?.message || "admin_trainers_failed" }, { status: 500 });
  }
}
