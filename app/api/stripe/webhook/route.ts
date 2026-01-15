// app/api/stripe/webhook/route.ts
import { NextResponse } from "next/server";
import stripe from "@/lib/stripe"; // new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2024-06-20" })
import { getRedis } from "@/lib/redis";
import { prisma } from "@/lib/prisma";
import { Resend } from "resend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ✅ Resend (optionnel) — si pas de clé, on skip sans casser
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

async function shopifyGraphQL(query: string, variables: any) {
  const shop = process.env.SHOP_DOMAIN!;
  const token = process.env.ADMIN_TOKEN!;
  const res = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
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

// ✅ Essaye de retrouver un Course via metadata (handle / productId / variantId)
async function resolveCourseFromSession(session: any) {
  const md = session?.metadata || {};

  // 1) direct product id
  const productIdRaw = md.shopify_product_id || md.shopifyProductId || null;
  if (productIdRaw) {
    const pid = String(productIdRaw).trim();
    const course = await (prisma as any).course.findFirst({
      where: { shopifyProductId: pid },
    });
    if (course) return course;
  }

  // 2) handle -> product id via Shopify
  const handle = md.shopify_product_handle || md.shopifyProductHandle || null;
  if (handle && process.env.SHOP_DOMAIN && process.env.ADMIN_TOKEN) {
    const data = await shopifyGraphQL(
      `
      query ProductByHandle($handle: String!) {
        productByHandle(handle: $handle) { id }
      }
      `,
      { handle: String(handle) }
    );

    const gid = data?.productByHandle?.id || null;
    const pid = gidToNumericId(gid);
    if (pid) {
      const course = await (prisma as any).course.findFirst({
        where: { shopifyProductId: String(pid) },
      });
      if (course) return course;
    }
  }

  // 3) variant id -> product id via Shopify
  const variantId = md.shopify_variant_id || md.shopifyVariantId || null;
  if (variantId && process.env.SHOP_DOMAIN && process.env.ADMIN_TOKEN) {
    const gid = String(variantId).startsWith("gid://")
      ? String(variantId)
      : `gid://shopify/ProductVariant/${String(variantId)}`;

    const data = await shopifyGraphQL(
      `
      query Variant($id: ID!) {
        productVariant(id: $id) {
          id
          product { id handle }
        }
      }
      `,
      { id: gid }
    );

    const productGid = data?.productVariant?.product?.id || null;
    const pid = gidToNumericId(productGid);
    if (pid) {
      const course = await (prisma as any).course.findFirst({
        where: { shopifyProductId: String(pid) },
      });
      if (course) return course;
    }
  }

  return null;
}

function moneyFromSession(session: any) {
  const amountCents = Number(session?.amount_total || 0);
  const currency = String(session?.currency || "eur").toUpperCase();
  return { amountCents, currency };
}

async function sendPurchaseEmail(opts: {
  to: string;
  courseTitle: string;
  amountCents: number;
  currency: string;
  libraryUrl: string;
}) {
  if (!resend) return;

  const from = process.env.EMAIL_FROM || "MarketFormation <noreply@marketformation.fr>";
  const { to, courseTitle, amountCents, currency, libraryUrl } = opts;

  const amountText =
    amountCents > 0 ? `${(amountCents / 100).toFixed(2)} ${currency}` : `0,00 ${currency}`;

  const subject = `✅ Paiement confirmé — ${courseTitle}`;

  const html = `
  <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial;line-height:1.5;color:#111827">
    <div style="max-width:560px;margin:0 auto;padding:24px">
      <div style="font-weight:800;font-size:18px;letter-spacing:-.01em">MarketFormation</div>
      <div style="margin-top:14px;padding:14px 16px;border-radius:14px;background:#F5F3FF;border:1px solid #EDE9FE">
        <div style="font-weight:800;color:#4C1D95">Paiement confirmé ✅</div>
        <div style="margin-top:6px;color:#111827">
          Ta formation <b>${courseTitle}</b> est maintenant disponible dans <b>Mes formations</b>.
        </div>
        <div style="margin-top:8px;color:#111827">Montant : <b>${amountText}</b></div>
        <a href="${libraryUrl}" style="display:inline-block;margin-top:12px;background:#7C3AED;color:white;text-decoration:none;padding:10px 14px;border-radius:12px;font-weight:700">
          Accéder à Mes formations →
        </a>
      </div>

      <div style="margin-top:14px;color:#6B7280;font-size:12px">
        Si tu ne vois pas la formation immédiatement, rafraîchis la page “Mes formations”.
      </div>
    </div>
  </div>
  `;

  await resend.emails.send({ from, to, subject, html });
}

export async function POST(req: Request) {
  try {
    const sig = req.headers.get("stripe-signature");
    if (!sig) {
      return NextResponse.json({ ok: false, error: "missing stripe-signature" }, { status: 400 });
    }

    const raw = await req.text();

    // ✅ Multi-secrets
    const secrets = [
      process.env.STRIPE_WEBHOOK_SECRET_MF_2,
      process.env.STRIPE_WEBHOOK_SECRET,
      process.env.STRIPE_WEBHOOK_SECRET_PLATFORM,
    ].filter(Boolean) as string[];

    if (!secrets.length) {
      return NextResponse.json({ ok: false, error: "missing STRIPE_WEBHOOK_SECRET" }, { status: 500 });
    }

    // ✅ Vérifie + reconstruit event signé (essaie plusieurs secrets)
    let event: any = null;
    let lastErr: any = null;

    for (const s of secrets) {
      try {
        event = stripe.webhooks.constructEvent(raw, sig, s);
        lastErr = null;
        break;
      } catch (e: any) {
        lastErr = e;
      }
    }

    if (!event) {
      return NextResponse.json(
        { ok: false, error: `invalid signature: ${lastErr?.message || lastErr}` },
        { status: 400 }
      );
    }

    // =========================
    // ✅ IDÉMPOTENCE (anti double)
    // =========================
    const redis = getRedis();
    const eventId = event?.id as string | undefined;

    if (eventId) {
      const key = `stripe:webhook:processed:${eventId}`;
      const firstTime = await redis.set(key, "1", {
        NX: true,
        EX: 60 * 60 * 24 * 7,
      });

      if (firstTime !== "OK") {
        return NextResponse.json({ received: true, dedup: true }, { status: 200 });
      }
    }

    // =========================
    // ✅ ROUTAGE
    // =========================
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as any;

        // -------------------
        // 1) ✅ TES MÉTRIQUES (inchangé)
        // -------------------
        const trainerId =
          session?.metadata?.trainer_id ||
          session?.metadata?.trainerId ||
          session?.metadata?.trainer ||
          null;

        if (trainerId) {
          const amountCents = Number(session?.amount_total || 0);

          await redis.incr(`sales:count:30d:${trainerId}`);
          if (amountCents > 0) await redis.incrBy(`sales:revenue:30d:${trainerId}`, amountCents);

          await redis.incr(`sales:count:total:${trainerId}`);
          if (amountCents > 0) await redis.incrBy(`sales:revenue:total:${trainerId}`, amountCents);
        }

        // -------------------
        // 2) ✅ CRÉER L’ACCÈS (StudentCourse)
        // -------------------
        const buyerEmailRaw =
          session?.customer_details?.email ||
          session?.customer_email ||
          session?.metadata?.buyer_email ||
          null;

        const buyerEmail = buyerEmailRaw ? String(buyerEmailRaw).toLowerCase().trim() : null;

        const shopifyCustomerId =
          session?.metadata?.shopify_customer_id ||
          session?.metadata?.shopifyCustomerId ||
          null;

        let createdAccess = false;

        let course: any = null;
        if (buyerEmail) {
          course = await resolveCourseFromSession(session);

          if (course?.id) {
            const existing = await (prisma as any).studentCourse.findFirst({
              where: { studentEmail: buyerEmail, courseId: course.id, archived: false },
              select: { id: true },
            });

            if (!existing?.id) {
              await (prisma as any).studentCourse.create({
                data: {
                  studentEmail: buyerEmail,
                  shopifyCustomerId: shopifyCustomerId ? String(shopifyCustomerId) : null,
                  courseId: course.id,

                  // Stripe ≠ Shopify: on log l’ID session pour audit
                  shopifyOrderId: session?.id ? String(session.id) : null,
                  shopifyLineItemId: null,

                  purchaseDate: new Date(),
                  lastAccessAt: null,
                  status: "NOT_STARTED",
                  archived: false,
                },
              });

              createdAccess = true;
            }
          } else {
            console.warn("[MF] checkout.session.completed: no course resolved from metadata", {
              session_id: session?.id,
              metadata: session?.metadata || {},
            });
          }
        } else {
          console.warn("[MF] checkout.session.completed: missing buyer email", {
            session_id: session?.id,
          });
        }

        // -------------------
        // 3) ✅ EMAIL CONFIRMATION (indépendant de createdAccess)
        // -------------------
        if (buyerEmail) {
          const { amountCents, currency } = moneyFromSession(session);
          const base = process.env.PUBLIC_SITE_URL || "https://marketformation.fr";
          const libraryUrl = `${base}/pages/mes-formations`;

          const title =
            session?.metadata?.course_title ||
            course?.title ||
            course?.shopifyProductTitle ||
            "Formation";

          await sendPurchaseEmail({
            to: buyerEmail,
            courseTitle: String(title),
            amountCents,
            currency,
            libraryUrl,
          }).catch((e) => console.error("[MF] email send failed:", e));
        }

        console.log("[MF] checkout.session.completed handled", {
          session_id: session?.id,
          trainerId: trainerId || null,
          createdAccess,
        });

        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        // TODO: sync status plan
        break;
      }

      case "invoice.payment_succeeded":
      case "invoice.payment_failed": {
        const invoice = event.data.object as any;

        if (event.type === "invoice.payment_succeeded") {
          const trainerId =
            invoice?.metadata?.trainer_id ||
            invoice?.metadata?.trainerId ||
            null;

          if (trainerId) {
            const amountCents = Number(invoice?.amount_paid || 0);

            await redis.incr(`sales:count:30d:${trainerId}`);
            if (amountCents > 0) await redis.incrBy(`sales:revenue:30d:${trainerId}`, amountCents);

            await redis.incr(`sales:count:total:${trainerId}`);
            if (amountCents > 0) await redis.incrBy(`sales:revenue:total:${trainerId}`, amountCents);
          }
        }

        void invoice;
        break;
      }

      default: {
        // unhandled
      }
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "webhook_error" }, { status: 400 });
  }
}
