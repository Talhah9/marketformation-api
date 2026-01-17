// app/proxy/student/progress/route.ts
// App Proxy: /apps/mf/student/progress  ->  /proxy/student/progress
// ✅ Vérifie signature App Proxy
// ✅ Update progression StudentCourse (progressPct, lastLessonId, lastAccessAt, status, completedAt, progressData)

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

  const computed = crypto
    .createHmac("sha256", APP_PROXY_SHARED_SECRET)
    .update(message)
    .digest("hex");

  const a = Uint8Array.from(Buffer.from(computed, "utf8"));
  const b = Uint8Array.from(Buffer.from(signature, "utf8"));
  const match = a.length === b.length && crypto.timingSafeEqual(a, b);

  return match ? { ok: true } : { ok: false, error: "invalid_signature" };
}

function clampInt(n: any, min: number, max: number) {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, Math.round(x)));
}

export async function POST(req: NextRequest) {
  try {
    const sig = verifyAppProxySignature(req);
    if (!sig.ok) return json({ ok: false, error: sig.error }, 401);

    const sp = req.nextUrl.searchParams;
    const email = (sp.get("email") || "").trim().toLowerCase() || null;
    const customerId = (sp.get("shopifyCustomerId") || "").trim() || null;

    if (!email && !customerId) {
      return json({ ok: false, error: "email_or_customerId_required" }, 400);
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch (_) {}

    const courseId = String(body?.courseId || "").trim();
    if (!courseId) return json({ ok: false, error: "missing_courseId" }, 400);

    const progressPct = clampInt(body?.progressPct, 0, 100);
    const lastLessonId = body?.lastLessonId != null ? String(body.lastLessonId) : null;

    const patchProgressData =
      body?.progressData && typeof body.progressData === "object" ? body.progressData : null;

    // 🔎 Trouve l’enrollment
    const or: any[] = [];
    if (email) or.push({ studentEmail: email });
    if (customerId) or.push({ shopifyCustomerId: customerId });

    const sc = await (prisma as any).studentCourse.findFirst({
      where: { courseId, archived: false, OR: or },
      select: { id: true, status: true, progressData: true },
    });

    if (!sc?.id) return json({ ok: false, error: "enrollment_not_found" }, 404);

    const now = new Date();
    const status =
      progressPct >= 100 ? "COMPLETED" : progressPct > 0 ? "IN_PROGRESS" : "NOT_STARTED";

    const nextProgressData =
      patchProgressData
        ? { ...(sc.progressData || {}), ...patchProgressData }
        : (sc.progressData || null);

    await (prisma as any).studentCourse.update({
      where: { id: sc.id },
      data: {
        progressPct,
        lastLessonId,
        lastAccessAt: now,
        status,
        completedAt: progressPct >= 100 ? now : null,
        progressData: nextProgressData,
      },
    });

    return json({ ok: true, status, progressPct });
  } catch (err: any) {
    console.error("[proxy/student/progress] error:", err);
    return json({ ok: false, error: "server_error", message: err?.message || String(err) }, 500);
  }
}
