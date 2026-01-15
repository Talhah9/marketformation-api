import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { verifyShopifyAppProxy } from "@/app/api/_lib/proxy";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2024-06-20" });

function json(data: any, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function ensureProxy(req: NextRequest) {
  const secret = process.env.APP_PROXY_SHARED_SECRET || "";
  return verifyShopifyAppProxy(req, secret);
}

export async function GET(req: NextRequest) {
  try {
    if (!ensureProxy(req)) return json({ ok: false, error: "invalid_proxy_signature" }, 401);

    const sessionId = (req.nextUrl.searchParams.get("session_id") || "").trim();
    if (!sessionId) return json({ ok: false, error: "missing_session_id" }, 400);

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["customer_details"],
    });

    if (session.payment_status !== "paid") {
      return json({ ok: false, error: "not_paid", payment_status: session.payment_status }, 400);
    }

    const md = (session.metadata || {}) as Record<string, string>;

    const buyerEmail =
      (md.buyer_email || session.customer_details?.email || "").toLowerCase().trim();

    const shopifyCustomerId = (md.buyer_shopify_customer_id || "").trim() || null;
    const shopifyProductId = (md.shopify_product_id || "").trim();

    if (!buyerEmail) return json({ ok: false, error: "missing_buyer_email" }, 400);
    if (!shopifyProductId) return json({ ok: false, error: "missing_shopify_product_id" }, 400);

    const course: any = await (prisma as any).course.findUnique({
      where: { shopifyProductId: shopifyProductId },
    });

    if (!course) return json({ ok: false, error: "course_not_found", shopifyProductId }, 404);

    const orderId = `stripe:${session.id}`;
    const lineId = session.payment_intent
      ? `stripe:${String(session.payment_intent)}`
      : orderId;

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

    return json({
      ok: true,
      created: !existing,
      courseId: course.id,
      email: buyerEmail,
      shopifyProductId,
      session_id: session.id,
    });
  } catch (err: any) {
    console.error("[MF] /proxy/stripe/verify GET error", err);
    return json({ ok: false, error: err?.message || "server_error" }, 500);
  }
}
