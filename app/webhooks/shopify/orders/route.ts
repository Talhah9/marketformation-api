import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2024-06-20" });

export async function POST(req: NextRequest) {
  let event: Stripe.Event;

  try {
    const sig = req.headers.get("stripe-signature");
    if (!sig) {
      return NextResponse.json({ ok: false, error: "missing_stripe_signature" }, { status: 400 });
    }

    const rawBody = await req.text();
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    console.error("[MF][stripe-webhook] ❌ invalid signature", err);
    return NextResponse.json({ ok: false, error: "invalid_signature" }, { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;

      if (session.payment_status !== "paid") {
        return NextResponse.json({ ok: true, skipped: true, reason: "not_paid" });
      }

      const md = (session.metadata || {}) as Record<string, string>;

      const buyerEmail =
        (md.buyer_email || session.customer_details?.email || "").toLowerCase().trim();

      const shopifyCustomerId = (md.buyer_shopify_customer_id || "").trim() || null;
      const shopifyProductId = (md.shopify_product_id || "").trim(); // ✅ must map to Course.shopifyProductId

      if (!buyerEmail) {
        console.warn("[MF][stripe-webhook] missing buyer email", { sessionId: session.id });
        return NextResponse.json({ ok: true, skipped: true, reason: "missing_buyer_email" });
      }

      if (!shopifyProductId) {
        console.warn("[MF][stripe-webhook] missing shopify_product_id", { sessionId: session.id, md });
        return NextResponse.json({ ok: true, skipped: true, reason: "missing_shopify_product_id" });
      }

      // ✅ retrouver le Course via shopifyProductId (unique)
      const course: any = await (prisma as any).course.findUnique({
        where: { shopifyProductId: shopifyProductId },
      });

      if (!course) {
        console.warn("[MF][stripe-webhook] course_not_found", { shopifyProductId, sessionId: session.id });
        return NextResponse.json({ ok: true, skipped: true, reason: "course_not_found" });
      }

      const orderId = `stripe:${session.id}`;
      const lineId = session.payment_intent
        ? `stripe:${String(session.payment_intent)}`
        : orderId;

      // ✅ idempotence : ne crée pas 2 fois la même entrée
      const existing = await (prisma as any).studentCourse.findFirst({
        where: {
          studentEmail: buyerEmail,
          shopifyOrderId: orderId,
          courseId: course.id,
        },
      });

      if (!existing) {
        await (prisma as any).studentCourse.create({
          data: {
            studentEmail: buyerEmail,
            shopifyCustomerId,
            shopifyOrderId: orderId,
            shopifyLineItemId: lineId,
            courseId: course.id,
            purchaseDate: new Date(),
          },
        });
      }

      console.log("[MF][stripe-webhook] ✅ access granted", {
        created: !existing,
        buyerEmail,
        courseId: course.id,
        shopifyProductId,
        sessionId: session.id,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[MF][stripe-webhook] ❌ handler error", err);
    return NextResponse.json({ ok: false, error: "handler_error" }, { status: 500 });
  }
}
