// app/api/student/courses/route.ts
// API interne (non App Proxy) — liste des formations achetées par un élève
// GET /api/student/courses?email=...&shopifyCustomerId=...

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: any, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
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

  // fallback via accessUrl
  const u = String(sc?.course?.accessUrl || "").toLowerCase();
  if (u.includes(".mp4") || u.includes("video") || u.includes("player")) return "video";
  return "pdf";
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const email = (searchParams.get("email") || "").trim() || null;
    const customerId = (searchParams.get("shopifyCustomerId") || "").trim() || null;

    if (!email && !customerId) {
      return json({ ok: false, error: "email_or_customerId_required" }, 400);
    }

    const or: any[] = [];
    if (email) or.push({ studentEmail: email.toLowerCase() });
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

      // ✅ progression réelle (si tu as ajouté progressPct)
      const progressPct =
        typeof sc?.progressPct === "number"
          ? Math.max(0, Math.min(100, sc.progressPct))
          : 0;

      const accessUrl = sc?.course?.accessUrl ?? sc?.course?.access_url ?? null;
      const pdfUrl = sc?.course?.pdfUrl ?? sc?.course?.pdf_url ?? null;

      const base: any = {
        id: sc?.course?.id,
        product_id,
        title,
        subtitle,
        status: String(sc?.status ?? "IN_PROGRESS").toLowerCase(),

        image_url: sc?.course?.imageUrl ?? null,
        cover,

        purchase_date: purchaseISO,
        last_access_at: lastAccessISO,

        purchasedAt,
        lastActivity,
        progressPct,

        access_url: accessUrl,
        cta_label: type === "video" ? "Commencer la formation" : "Lire la formation",
        type,
      };

      if (type === "pdf") {
        const viewUrl = pdfUrl || accessUrl || "";
        base.pdf = {
          pages: sc?.course?.pdfPages ?? "—",
          viewUrl,
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
    console.error("[api/student/courses] error:", err);
    return json({ ok: false, error: "server_error", message: err?.message || String(err) }, 500);
  }
}
