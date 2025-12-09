// app/webhooks/shopify/orders/route.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";

function verifyShopifyHmac(
  rawBody: string,
  hmacHeader: string | null,
  secret: string
): boolean {
  if (!hmacHeader) return false;

  const digest = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");

  const digestBuf = Buffer.from(digest, "utf8");
  const hmacBuf = Buffer.from(hmacHeader, "utf8");

  if (digestBuf.length !== hmacBuf.length) return false;

  // 👇 Cast en any pour éviter l'erreur TS ArrayBufferView / Buffer
  return crypto.timingSafeEqual(digestBuf as any, hmacBuf as any);
}

export async function POST(req: NextRequest) {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[MF] Missing SHOPIFY_WEBHOOK_SECRET");
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  const rawBody = await req.text();
  const hmacHeader = req.headers.get("x-shopify-hmac-sha256");
  const topic = req.headers.get("x-shopify-topic") || "";

  // ✅ Vérification HMAC
  if (!verifyShopifyHmac(rawBody, hmacHeader, secret)) {
    console.warn("[MF] Invalid HMAC");
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  // ✅ On ne traite que les commandes payées
  if (topic !== "orders/paid") {
    return NextResponse.json({ ok: true, ignored: true }, { status: 200 });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch (e) {
    console.error("[MF] JSON parse error", e);
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  try {
    const prismaAny = prisma as any; // 👈 hack TS comme sur student/courses

    const orderId = String(payload.id);
    const customer = payload.customer || {};
    const email = customer.email;
    const shopifyCustomerId = customer.id ? String(customer.id) : null;

    if (!email) {
      console.warn("[MF] Order paid but missing email");
      return NextResponse.json(
        { ok: true, skipped: "no_email" },
        { status: 200 }
      );
    }

    const lineItems = payload.line_items || [];
    const purchasedAt = new Date(
      payload.processed_at || payload.created_at || new Date().toISOString()
    );

    for (const li of lineItems) {
      const productId = li.product_id ? String(li.product_id) : null;
      const lineItemId = li.id ? String(li.id) : null;

      if (!productId) continue;

      // 🔎 Trouver la formation liée au produit Shopify
      const course = await prismaAny.course.findUnique({
        where: { shopifyProductId: productId },
      });

      if (!course) {
        // Pas une formation MarketFormation : on ignore
        continue;
      }

      // 🔁 Idempotence : vérifier si déjà enrôlé
      const existing = await prismaAny.studentCourse.findFirst({
        where: {
          studentEmail: email,
          courseId: course.id,
          shopifyOrderId: orderId,
          shopifyLineItemId: lineItemId || undefined,
        },
      });

      if (existing) continue;

      // 🧑‍🎓 Créer l'enrôlement élève
      await prismaAny.studentCourse.create({
        data: {
          studentEmail: email,
          shopifyCustomerId,
          courseId: course.id,
          shopifyOrderId: orderId,
          shopifyLineItemId: lineItemId || null,
          status: "IN_PROGRESS",
          purchaseDate: purchasedAt,
        },
      });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("[MF] Webhook orders error:", err);
    // On renvoie 200 pour que Shopify ne spamme pas, mais on log l’erreur
    return NextResponse.json({ ok: true, logged: true }, { status: 200 });
  }
}
