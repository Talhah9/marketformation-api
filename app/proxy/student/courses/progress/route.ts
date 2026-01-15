// app/proxy/student/progress/route.ts
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

export async function POST(req: NextRequest) {
  try {
    const sig = verifyAppProxySignature(req);
    if (!sig.ok) return json({ ok: false, error: sig.error }, 401);

    const url = new URL(req.url);
    const email = (url.searchParams.get("email") || "").trim().toLowerCase() || null;
    const customerId = (url.searchParams.get("shopifyCustomerId") || "").trim() || null;

    if (!email && !customerId) return json({ ok: false, error: "email_or_customerId_required" }, 400);

    const body = await req.json().catch(() => ({}));
    const courseId = String(body?.courseId || "").trim();
    if (!courseId) return json({ ok: false, error: "missing_courseId" }, 400);

    const progressPct = Math.max(0, Math.min(100, Number(body?.progressPct ?? 0)));
    const lastLessonId = body?.lastLessonId != null ? String(body.lastLessonId) : null;
    const meta = body?.meta ?? null;

    const whereOr: any[] = [];
    if (email) whereOr.push({ studentEmail: email });
    if (customerId) whereOr.push({ shopifyCustomerId: customerId });

    // find enrollment
    const sc: any = await (prisma as any).studentCourse.findFirst({
      where: { courseId, archived: false, OR: whereOr },
      select: { id: true },
    });
    if (!sc?.id) return json({ ok: false, error: "not_enrolled" }, 404);

    const status =
      progressPct >= 100 ? "COMPLETED" : progressPct > 0 ? "IN_PROGRESS" : "NOT_STARTED";

    const updated = await (prisma as any).studentCourse.update({
      where: { id: sc.id },
      data: {
        progressPct,
        lastLessonId,
        progressMeta: meta,
        lastAccessAt: new Date(),
        status,
      },
    });

    return json({ ok: true, progressPct: updated.progressPct, status: updated.status }, 200);
  } catch (err: any) {
    console.error("[proxy/student/progress] error:", err);
    return json({ ok: false, error: "server_error", message: err?.message || String(err) }, 500);
  }
}
