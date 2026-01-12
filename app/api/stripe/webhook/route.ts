// app/api/stripe/webhook/route.ts
import { NextResponse } from "next/server";
import stripe from "@/lib/stripe"; // new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2024-06-20" })
import { getRedis } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const sig = req.headers.get("stripe-signature");
    if (!sig) {
      return NextResponse.json(
        { ok: false, error: "missing stripe-signature" },
        { status: 400 }
      );
    }

    const raw = await req.text();

    // ✅ Multi-secrets (2 destinations -> 2 whsec)
    const secrets = [
      process.env.STRIPE_WEBHOOK_SECRET_MF_2,
      process.env.STRIPE_WEBHOOK_SECRET,
      process.env.STRIPE_WEBHOOK_SECRET_PLATFORM,
    ].filter(Boolean) as string[];

    if (!secrets.length) {
      return NextResponse.json(
        { ok: false, error: "missing STRIPE_WEBHOOK_SECRET" },
        { status: 500 }
      );
    }

    // ✅ Vérifie et reconstruit l’évènement signé (essaie plusieurs secrets)
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
    //  IDÉMPOTENCE (anti double)
    // =========================
    const redis = getRedis();
    const eventId = event?.id as string | undefined;

    if (eventId) {
      const key = `stripe:webhook:processed:${eventId}`;
      const firstTime = await redis.set(key, "1", {
        NX: true,
        EX: 60 * 60 * 24 * 7, // 7 jours
      });

      if (firstTime !== "OK") {
        return NextResponse.json({ received: true, dedup: true }, { status: 200 });
      }
    }

    // =========================
    //  ROUTAGE DES ÉVÉNEMENTS
    // =========================
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as any;

        // IMPORTANT: pour attribuer au bon formateur, il faut metadata.trainer_id
        const trainerId =
          session?.metadata?.trainer_id ||
          session?.metadata?.trainerId ||
          session?.metadata?.trainer ||
          null;

        if (trainerId) {
          const amountCents = Number(session?.amount_total || 0);

          await redis.incr(`sales:count:30d:${trainerId}`);
          if (amountCents > 0) {
            await redis.incrBy(`sales:revenue:30d:${trainerId}`, amountCents);
          }

          await redis.incr(`sales:count:total:${trainerId}`);
          if (amountCents > 0) {
            await redis.incrBy(`sales:revenue:total:${trainerId}`, amountCents);
          }
        }

        // TODO (ton existant): sync subscription / customer / shopifyCustomerId etc.
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        // TODO: sync status plan (active / trialing / past_due / canceled)
        break;
      }

      case "invoice.payment_succeeded":
      case "invoice.payment_failed": {
        const invoice = event.data.object as any;

        // Option : compter aussi les invoices si trainer_id est présent
        if (event.type === "invoice.payment_succeeded") {
          const trainerId =
            invoice?.metadata?.trainer_id ||
            invoice?.metadata?.trainerId ||
            null;

          if (trainerId) {
            const amountCents = Number(invoice?.amount_paid || 0);

            await redis.incr(`sales:count:30d:${trainerId}`);
            if (amountCents > 0) {
              await redis.incrBy(`sales:revenue:30d:${trainerId}`, amountCents);
            }

            await redis.incr(`sales:count:total:${trainerId}`);
            if (amountCents > 0) {
              await redis.incrBy(`sales:revenue:total:${trainerId}`, amountCents);
            }
          }
        }

        // TODO: logging / métriques / email interne si besoin
        void invoice;
        break;
      }

      default: {
        // console.log("[stripe webhook] unhandled event:", event.type);
      }
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "webhook_error" },
      { status: 400 }
    );
  }
}
