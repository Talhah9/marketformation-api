// app/api/stripe/webhook/route.ts
import { NextResponse } from "next/server";
import stripe from "@/lib/stripe";
import { getRedis } from "@/lib/redis";
import { prisma } from "@/lib/prisma";
import { Resend } from "resend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* =========================
   RESEND
========================= */
const resend =
  process.env.RESEND_API_KEY && process.env.RESEND_API_KEY.startsWith("re_")
    ? new Resend(process.env.RESEND_API_KEY)
    : null;

/* =========================
   SHOPIFY GRAPHQL
========================= */
async function shopifyGraphQL(query: string, variables: any) {
  const shop = process.env.SHOP_DOMAIN!;
  const token =
    process.env.SHOP_ADMIN_TOKEN ||
    process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN ||
    process.env.ADMIN_TOKEN ||
    "";

  if (!shop) throw new Error("Missing env SHOP_DOMAIN");
  if (!token) throw new Error("Missing env ADMIN_TOKEN/SHOP_ADMIN_TOKEN");

  const res = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
      Accept: "application/json",
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });

  const json = await res.json();
  if (!res.ok || json.errors) {
    throw new Error(json?.errors?.[0]?.message || `Shopify GraphQL error (${res.status})`);
  }
  return json.data;
}

function gidToNumericId(gid?: string | null) {
  if (!gid) return null;
  const m = String(gid).match(/\/(\d+)$/);
  return m ? m[1] : null;
}

/* =========================
   ✅ SALES COUNT (mfapp.sales_count)
========================= */
function toIntSafe(v: any) {
  const n = parseInt(String(v ?? "").trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

function productGidFromNumericId(productId: string | number) {
  const s = String(productId || "").trim();
  if (!s) return "";
  if (s.startsWith("gid://")) return s;
  if (/^\d+$/.test(s)) return `gid://shopify/Product/${s}`;
  return "";
}

async function getProductSalesCount(productGid: string) {
  const q = `
    query GetSales($id: ID!) {
      product(id: $id) {
        sales: metafield(namespace:"mfapp", key:"sales_count") { value }
      }
    }
  `;
  const data = await shopifyGraphQL(q, { id: productGid });
  const val = data?.product?.sales?.value;
  return toIntSafe(val);
}

async function setProductSalesCount(productGid: string, nextVal: number) {
  const m = `
    mutation SetSales($ownerId: ID!, $value: String!) {
      metafieldsSet(metafields: [{
        ownerId: $ownerId,
        namespace: "mfapp",
        key: "sales_count",
        type: "number_integer",
        value: $value
      }]) {
        userErrors { field message }
      }
    }
  `;
  const data = await shopifyGraphQL(m, { ownerId: productGid, value: String(nextVal) });
  const errs = data?.metafieldsSet?.userErrors || [];
  if (errs.length) {
    throw new Error(errs[0]?.message || "metafieldsSet_failed");
  }
}

async function incProductSalesCount(productIdOrGid: string) {
  const productGid = productGidFromNumericId(productIdOrGid);
  if (!productGid) return;

  const curr = await getProductSalesCount(productGid);
  await setProductSalesCount(productGid, curr + 1);

  console.log("[MF][sales_count] incremented", { productGid, from: curr, to: curr + 1 });
}

/* =========================
   COURSE RESOLUTION
========================= */
async function resolveCourseFromSession(session: any) {
  const md = session?.metadata || {};

  // 1) product id direct
  const productIdRaw = md.shopify_product_id || md.shopifyProductId || null;
  if (productIdRaw) {
    const course = await prisma.course.findFirst({
      where: { shopifyProductId: String(productIdRaw) },
    });
    if (course) return course;
  }

  // 2) handle
  const handle = md.shopify_product_handle || md.shopifyProductHandle || null;
  if (handle) {
    const data = await shopifyGraphQL(
      `query ($handle: String!) { productByHandle(handle: $handle) { id } }`,
      { handle }
    );

    const pid = gidToNumericId(data?.productByHandle?.id);
    if (pid) {
      const course = await prisma.course.findFirst({
        where: { shopifyProductId: String(pid) },
      });
      if (course) return course;
    }
  }

  // 3) variant
  const variantId = md.shopify_variant_id || md.shopifyVariantId || null;
  if (variantId) {
    const gid = String(variantId).startsWith("gid://")
      ? String(variantId)
      : `gid://shopify/ProductVariant/${variantId}`;

    const data = await shopifyGraphQL(
      `query ($id: ID!) { productVariant(id: $id) { product { id } } }`,
      { id: gid }
    );

    const pid = gidToNumericId(data?.productVariant?.product?.id);
    if (pid) {
      const course = await prisma.course.findFirst({
        where: { shopifyProductId: String(pid) },
      });
      if (course) return course;
    }
  }

  return null;
}

function moneyFromSession(session: any) {
  return {
    amountCents: Number(session?.amount_total || 0),
    currency: String(session?.currency || "eur").toUpperCase(),
  };
}

/* =========================
   ✅ PAYOUT HELPERS (NEW)
========================= */
function safeText(v: any) {
  return String(v ?? "").trim();
}

function resolveTrainerIdForSale(session: any, course: any) {
  const md = session?.metadata || {};

  // 1) metadata trainer_id (fourni par ton checkout subscription et tu peux le fournir aussi côté payment)
  const t = safeText(md.trainer_id || md.trainerId);
  if (t) return t;

  // 2) fallback DB course
  const sid = safeText(course?.trainerShopifyId);
  if (sid) return `trainer-${sid}`;

  const em = safeText(course?.trainerEmail).toLowerCase();
  if (em) return `email:${em}`;

  return "";
}

function feePctFromEnv() {
  const n = Number(process.env.MF_FEE_PCT ?? 20);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : 20;
}

/* =========================
   EMAIL (INSTRUMENTÉ)
========================= */
async function sendPurchaseEmail(opts: {
  to: string;
  courseTitle: string;
  amountCents: number;
  currency: string;
  libraryUrl: string;
}) {
  console.log("[MF][email] init", {
    resendReady: !!resend,
    to: opts.to,
    from: process.env.EMAIL_FROM,
  });

  if (!resend) {
    console.warn("[MF][email] SKIPPED — resend not configured");
    return;
  }

  const from = process.env.EMAIL_FROM || "MarketFormation <onboarding@resend.dev>";
  const { to, courseTitle, amountCents, currency, libraryUrl } = opts;

  const amountText =
    amountCents > 0 ? `${(amountCents / 100).toFixed(2)} ${currency}` : `0,00 ${currency}`;

  try {
    const res = await resend.emails.send({
      from,
      to,
      subject: `✅ Paiement confirmé — ${courseTitle}`,
      html: `
        <div style="font-family:system-ui">
          <h2>Paiement confirmé ✅</h2>
          <p>Formation : <b>${courseTitle}</b></p>
          <p>Montant : <b>${amountText}</b></p>
          <a href="${libraryUrl}">Accéder à mes formations</a>
        </div>
      `,
    });

    console.log("[MF][email] SENT", res);
  } catch (e: any) {
    console.error("[MF][email] FAILED", {
      message: e?.message,
      name: e?.name,
      statusCode: e?.statusCode,
    });
    throw e;
  }
}

/* =========================
   WEBHOOK
========================= */
export async function POST(req: Request) {
  try {
    const sig = req.headers.get("stripe-signature");
    if (!sig) {
      return NextResponse.json({ ok: false, error: "missing stripe-signature" }, { status: 400 });
    }

    const raw = await req.text();

    const secrets = [
      process.env.STRIPE_WEBHOOK_SECRET_MF_2,
      process.env.STRIPE_WEBHOOK_SECRET,
      process.env.STRIPE_WEBHOOK_SECRET_PLATFORM,
    ].filter(Boolean) as string[];

    let event: any;
    for (const s of secrets) {
      try {
        event = stripe.webhooks.constructEvent(raw, sig, s);
        break;
      } catch {}
    }

    if (!event) {
      return NextResponse.json({ ok: false, error: "invalid signature" }, { status: 400 });
    }

    // ✅ dedup redis
    const redis = getRedis();
    const key = `stripe:webhook:${event.id}`;
    const first = await redis.set(key, "1", { NX: true, EX: 86400 });
    if (first !== "OK") {
      return NextResponse.json({ received: true, dedup: true });
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as any;

      const buyerEmail =
        session?.customer_details?.email ||
        session?.customer_email ||
        session?.metadata?.buyer_email ||
        null;

      const course = await resolveCourseFromSession(session);

      // ✅ 1) Attribution existante (inchangée)
      if (buyerEmail && course) {
        const email = buyerEmail.toLowerCase().trim();

        const existing = await prisma.studentCourse.findFirst({
          where: {
            studentEmail: email,
            courseId: course.id,
            archived: false,
          },
          select: { id: true },
        });

        if (!existing?.id) {
          await prisma.studentCourse.create({
            data: {
              studentEmail: email,
              courseId: course.id,
              status: "NOT_STARTED",
              purchaseDate: new Date(),
              archived: false,
              shopifyOrderId: session?.id ? String(session.id) : null, // audit
            },
          });
        }
      }

      // ✅ 2) NEW — Créditer les revenus formateur (PayoutsHistory + PayoutsSummary)
      // Safe: uniquement si course résolue => évite de créditer les abonnements (plans).
      try {
        if (course) {
          const { amountCents, currency } = moneyFromSession(session);
          const gross = amountCents > 0 ? amountCents / 100 : 0;

          const trainerId = resolveTrainerIdForSale(session, course);
          const feePct = feePctFromEnv();
          const net = Math.max(0, gross * (1 - feePct / 100));

          if (trainerId && gross > 0 && net > 0) {
            const cur = String(currency || "EUR").toUpperCase();

            // history (vente)
            await prisma.payoutsHistory.create({
              data: {
                trainerId,
                type: "sale",
                status: "available",
                amount: net.toFixed(2) as any, // Decimal OK via string
                currency: cur,
                meta: {
                  sessionId: session?.id,
                  courseId: course?.id,
                  shopifyProductId: course?.shopifyProductId,
                  gross,
                  net,
                  feePct,
                },
              },
            });

            // summary (solde)
            await prisma.payoutsSummary.upsert({
              where: { trainerId },
              create: {
                trainerId,
                availableAmount: net.toFixed(2) as any,
                pendingAmount: "0" as any,
                currency: cur,
              },
              update: {
                availableAmount: { increment: net.toFixed(2) as any },
                currency: cur,
              },
            });

            console.log("[MF][payout] credited", {
              trainerId,
              gross,
              net,
              feePct,
              sessionId: session?.id,
            });
          } else {
            console.warn("[MF][payout] skip (missing trainerId or amount)", {
              trainerId,
              amountCents,
              gross,
              net,
            });
          }
        }
      } catch (e: any) {
        // non-blocking
        console.warn("[MF][payout] credit failed (non-blocking)", e?.message || e);
      }

      // ✅ 3) Tracking admin — incrémenter mfapp.sales_count
      // (On le fait si course résolue, indépendamment du mode)
      try {
        if (course?.shopifyProductId) {
          await incProductSalesCount(String(course.shopifyProductId));
        }
      } catch (e: any) {
        console.warn("[MF][sales_count] failed (non-blocking)", e?.message || e);
      }

      // ✅ 4) Email (inchangé)
      if (buyerEmail) {
        const { amountCents, currency } = moneyFromSession(session);
        const base = process.env.PUBLIC_SITE_URL || "https://marketformation.fr";

        await sendPurchaseEmail({
          to: buyerEmail,
          courseTitle: course?.title || "Formation",
          amountCents,
          currency,
          libraryUrl: `${base}/pages/mes-formations`,
        });
      }

      console.log("[MF] checkout.session.completed handled", {
        session_id: session.id,
        buyerEmail,
        courseResolved: !!course?.id,
      });
    }

    return NextResponse.json({ received: true });
  } catch (e: any) {
    console.error("[MF] webhook error", e);
    return NextResponse.json({ ok: false, error: e?.message }, { status: 400 });
  }
}
