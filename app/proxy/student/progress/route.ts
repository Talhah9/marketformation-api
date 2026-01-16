// app/proxy/student/progress/route.ts
// App Proxy: /apps/mf/student/progress -> /proxy/student/progress
// ✅ Vérifie signature App Proxy
// ✅ Met à jour la progression réelle (progressPct, lastAccessAt, status, lastLessonId, completedAt)

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APP_PROXY_SHARED_SECRET = process.env.APP_PROXY_SHARED_SECRET;

function json(data: any, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
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

  const computed = crypto.createHmac("sha256", APP_PROXY_SHARED_SECRET).update(message).digest("hex");

  const a = Uint8Array.from(Buffer.from(computed, "utf8"));
  const b = Uint8Array.from(Buffer.from(signature, "utf8"));
  const match = a.length === b.length && crypto.timingSafeEqual(a, b);

  return match ? { ok: true } : { ok: false, error: "invalid_signature" };
}

function clampPct(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function toCourseStatus(input: any) {
  const s = String(input || "").toLowerCase().trim();
  if (!s) return null;

  if (s === "completed" || s === "done" || s === "terminé" || s === "termine") return "COMPLETED";
  if (s === "not_started" || s === "not-started" || s === "new") return "NOT_STARTED";
  if (s === "in_progress" || s === "in-progress" || s === "progress") return "IN_PROGRESS";

  // compat: si tu passes déjà "in_progress" en lower
  if (s.includes("complete")) return "COMPLETED";
  if (s.includes("progress")) return "IN_PROGRESS";
  if (s.includes("not")) return "NOT_STARTED";

  return null;
}

export async function POST(req: NextRequest) {
  try {
    const sig = verifyAppProxySignature(req);
    if (!sig.ok) return json({ ok: false, error: sig.error }, 401);

    let body: any = {};
    try {
      body = await req.json();
    } catch (_) {}

    const email = String(body?.email || "").trim().toLowerCase() || null;
    const customerId = String(body?.shopifyCustomerId || "").trim() || null;
    const courseId = String(body?.courseId || "").trim() || null;

    if (!courseId) return json({ ok: false, error: "courseId_required" }, 400);
    if (!email && !customerId) return json({ ok: false, error: "email_or_customerId_required" }, 400);

    const progressPct = clampPct(body?.progressPct);
    const status = toCourseStatus(body?.status);
    const lastLessonId = body?.lastLessonId != null ? String(body.lastLessonId).trim() : null;

    // Trouver l'enrollment correspondant à CE cours + user
    const whereOr: any[] = [];
    if (email) whereOr.push({ studentEmail: email });
    if (customerId) whereOr.push({ shopifyCustomerId: customerId });

    const sc = await (prisma as any).studentCourse.findFirst({
      where: {
        courseId,
        archived: false,
        OR: whereOr,
      },
      select: { id: true },
    });

    if (!sc?.id) {
      return json({ ok: false, error: "student_course_not_found" }, 404);
    }

    const now = new Date();

    const data: any = {
      lastAccessAt: now,
    };

    if (progressPct != null) data.progressPct = progressPct;
    if (status) data.status = status;
    if (lastLessonId) data.lastLessonId = lastLessonId;

    // si terminé : completedAt
    if (status === "COMPLETED" || progressPct === 100) {
      data.status = "COMPLETED";
      data.progressPct = 100;
      data.completedAt = now;
    }

    await (prisma as any).studentCourse.update({
      where: { id: sc.id },
      data,
    });

    return json({ ok: true }, 200);
  } catch (err: any) {
    console.error("[proxy/student/progress] error:", err);
    return json({ ok: false, error: "server_error", message: err?.message || String(err) }, 500);
  }
}
