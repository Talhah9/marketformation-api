// app/proxy/student/courses/route.ts
// App Proxy: /apps/mf/student/courses  ->  /proxy/student/courses
// ✅ Vérifie signature App Proxy
// ✅ Réutilise la même logique que app/api/student/courses (Prisma)
// ✅ Retourne items compatibles UI (cards + modal)

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APP_PROXY_SHARED_SECRET = process.env.APP_PROXY_SHARED_SECRET;

function json(data: any, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function verifyAppProxySignature(req: NextRequest) {
  if (!APP_PROXY_SHARED_SECRET) return { ok: false, error: "missing_APP_PROXY_SHARED_SECRET" };

  const url = new URL(req.url);
  const signature = url.searchParams.get("signature");
  if (!signature) return { ok: false, error: "missing_signature" };

  const pairs: string[] = [];
  url.searchParams.forEach((value, key) => {
    if (key === "signature") return;
    pairs.push(`${key}=${value}`);
  });
  pairs.sort();
  const message = pairs.join("");

  const computed = crypto
    .createHmac("sha256", APP_PROXY_SHARED_SECRET)
    .update(message)
    .digest("hex");

  const a = Uint8Array.from(Buffer.from(computed, "utf8"));
  const b = Uint8Array.from(Buffer.from(signature, "utf8"));
  const match = a.length === b.length && crypto.timingSafeEqual(a, b);

  return match ? { ok: true } : { ok: false, error: "invalid_signature" };
}

function gidToNumericProductId(gid?: string | null) {
  if (!gid) return null;
  const m = String(gid).match(/\/Product\/(\d+)$/);
  return m ? Number(m[1]) : null;
}

// Petit helper: déduire type (pdf/video) sans casser
function guessType(sc: any) {
  const t =
    sc?.course?.type ||
    sc?.course?.format ||
    sc?.course?.mfapp_type ||
    sc?.course?.mfapp?.type ||
    "";

  const type = String(t || "").toLowerCase();
  if (type.includes("video")) return "video";
  if (type.includes("pdf")) return "pdf";

  // fallback via accessUrl (si tu stockes un lien vidéo ou pdf)
  const u = String(sc?.course?.accessUrl || "").toLowerCase();
  if (u.includes(".mp4") || u.includes("video") || u.includes("player")) return "video";
  return "pdf";
}

export async function GET(req: NextRequest) {
  try {
    // 1) sécurité App Proxy
    const sig = verifyAppProxySignature(req);
    if (!sig.ok) return json({ ok: false, error: sig.error }, 401);

    const { searchParams } = new URL(req.url);

    const email = (searchParams.get("email") || "").trim() || null;
    const customerId = (searchParams.get("shopifyCustomerId") || "").trim() || null;

    // même règle que ta route API
    if (!email && !customerId) {
      return json({ ok: false, error: "email_or_customerId_required" }, 400);
    }

    const or: any[] = [];
    if (email) or.push({ studentEmail: email });
    if (customerId) or.push({ shopifyCustomerId: customerId });

    const rows: any[] = await (prisma as any).studentCourse.findMany({
      where: { OR: or, archived: false },
      include: { course: true },
      orderBy: { purchaseDate: "desc" },
    });

    const items = rows.map((sc: any) => {
      const directId =
        sc?.course?.shopifyProductId ??
        sc?.course?.productId ??
        sc?.course?.shopify_product_id ??
        null;

      const gidId = gidToNumericProductId(
        sc?.course?.shopifyProductGid ?? sc?.course?.productGid ?? null
      );

      const product_id = directId != null ? Number(directId) : gidId;

      const type = guessType(sc);

      // Champs “UI cards”
      const title = sc?.course?.title || "Formation";
      const subtitle = sc?.course?.subtitle ?? "";
      const cover = sc?.course?.imageUrl ?? sc?.course?.image_url ?? null;

      const purchaseISO = sc?.purchaseDate ?? null;
      const lastAccessISO = sc?.lastAccessAt ?? sc?.last_access_at ?? null;

      const purchasedAt = purchaseISO
        ? new Date(purchaseISO).toLocaleDateString("fr-FR")
        : "—";

      const lastActivity = lastAccessISO
        ? new Date(lastAccessISO).toLocaleDateString("fr-FR")
        : "—";

      // Progression (si tu l’as dans DB plus tard, remplace ici)
      const progressPct =
        typeof sc?.progressPct === "number"
          ? Math.max(0, Math.min(100, sc.progressPct))
          : 0;

      // Accès contenu (page interne / route)
      const accessUrl = sc?.course?.accessUrl ?? sc?.course?.access_url ?? null;

      // ✅ IMPORTANT: URL PDF réelle stockée en DB (Prisma Course.pdfUrl)
      const pdfUrl = sc?.course?.pdfUrl ?? sc?.course?.pdf_url ?? null;

      // IMPORTANT: on garde aussi ton format ancien (compat)
      const base: any = {
        id: sc?.course?.id, // ton id interne
        product_id, // ✅ pour /apps/mf/download si tu utilises encore
        title,
        subtitle,
        category_label: sc?.course?.categoryLabel ?? "",
        level_label: sc?.course?.levelLabel ?? "",
        estimated_hours: sc?.course?.estimatedHours ?? 0,
        status: String(sc?.status ?? "IN_PROGRESS").toLowerCase(),
        image_url: sc?.course?.imageUrl ?? null,
        purchase_date: purchaseISO,
        last_access_at: lastAccessISO,

        // on garde access_url pour compat
        access_url: accessUrl,

        cta_label: type === "video" ? "Commencer la formation" : "Lire la formation",

        // ✅ champs attendus par la nouvelle UI
        type,
        cover,
        purchasedAt,
        lastActivity,
        progressPct,
      };

      if (type === "pdf") {
        // ✅ FIX: on privilégie le vrai PDF (pdfUrl). accessUrl en fallback.
        const viewUrl = (pdfUrl || accessUrl || "");

        base.pdf = {
          pages: sc?.course?.pdfPages ?? "—",
          viewUrl,
          // optionnel mais pratique côté UI (download button)
          downloadUrl: viewUrl,
        };
      } else {
        base.video = {
          url: accessUrl || "",
          totalDuration: sc?.course?.videoTotalDuration ?? "—",
          currentLessonId: null,
          lessons: Array.isArray(sc?.course?.modules) ? sc.course.modules : [],
        };
      }

      return base;
    });

    return json({ ok: true, items }, 200);
  } catch (err: any) {
    console.error("[proxy/student/courses] error:", err);
    return json(
      { ok: false, error: "server_error", message: err?.message || String(err) },
      500
    );
  }
}
