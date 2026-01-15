// app/proxy/content/pdf/route.ts
// App Proxy: /apps/mf/content/pdf -> /proxy/content/pdf
// ✅ Vérifie signature App Proxy
// ✅ Vérifie que l'élève a bien acheté (StudentCourse)
// ✅ Stream le PDF (pas de lien S3 exposé)

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APP_PROXY_SHARED_SECRET = process.env.APP_PROXY_SHARED_SECRET;

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

function safeFileName(name: string) {
  return String(name || "formation")
    .replace(/[^\w\-\. ]+/g, "")
    .trim()
    .slice(0, 80) || "formation";
}

export async function GET(req: NextRequest) {
  try {
    // 1) sécurité App Proxy
    const sig = verifyAppProxySignature(req);
    if (!sig.ok) {
      return NextResponse.json({ ok: false, error: sig.error }, { status: 401 });
    }

    const url = new URL(req.url);
    const email = (url.searchParams.get("email") || "").trim().toLowerCase() || null;
    const customerId = (url.searchParams.get("shopifyCustomerId") || "").trim() || null;

    // IMPORTANT: on utilise ton id interne Course (c'est ce que ta UI a déjà)
    const courseId = (url.searchParams.get("courseId") || "").trim() || null;

    const download = url.searchParams.get("download") === "1";

    if (!courseId) {
      return NextResponse.json({ ok: false, error: "missing_courseId" }, { status: 400 });
    }
    if (!email && !customerId) {
      return NextResponse.json({ ok: false, error: "email_or_customerId_required" }, { status: 400 });
    }

    // 2) vérifier que l'élève a accès (StudentCourse existe)
    const or: any[] = [];
    if (email) or.push({ studentEmail: email });
    if (customerId) or.push({ shopifyCustomerId: customerId });

    const sc = await (prisma as any).studentCourse.findFirst({
      where: {
        courseId,
        archived: false,
        OR: or,
      },
      include: { course: true },
    });

    if (!sc?.course) {
      return NextResponse.json({ ok: false, error: "forbidden_not_enrolled" }, { status: 403 });
    }

    const pdfUrl: string | null =
      sc.course.pdfUrl ?? sc.course.pdf_url ?? null;

    if (!pdfUrl) {
      return NextResponse.json({ ok: false, error: "pdf_not_available" }, { status: 404 });
    }

    // 3) stream du PDF (on n'expose pas l'URL)
    const upstream = await fetch(pdfUrl, { method: "GET" });

    if (!upstream.ok) {
      return NextResponse.json(
        { ok: false, error: "upstream_pdf_failed", status: upstream.status },
        { status: 502 }
      );
    }

    const buf = await upstream.arrayBuffer();

    const title = safeFileName(sc.course.title || "formation");
    const disposition = download
      ? `attachment; filename="${title}.pdf"`
      : `inline; filename="${title}.pdf"`;

    const headers = new Headers();
    headers.set("Content-Type", "application/pdf");
    headers.set("Content-Disposition", disposition);
    headers.set("Cache-Control", "no-store");

    return new NextResponse(buf, { status: 200, headers });
  } catch (err: any) {
    console.error("[MF] /proxy/content/pdf error", err);
    return NextResponse.json(
      { ok: false, error: err?.message || "server_error" },
      { status: 500 }
    );
  }
}
