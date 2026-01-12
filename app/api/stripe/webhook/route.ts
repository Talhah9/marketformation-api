// app/api/stripe/webhook/route.ts
import { NextResponse } from "next/server";
import stripe from "@/lib/stripe"; // new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' })
import { getRedis } from "@/lib/redis"; // <- ton helper Redis (node-redis)

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Stripe enverra un POST avec un body *brut* (string). On utilise req.text()
// et stripe.webhooks.constructEvent(raw, sig, secret) pour vérifier l’intégrité.

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
    const secret =
      process.env.STRIPE_WEBHOOK_SECRET_MF ||
      process.env.STRIPE_WEBHOOK_SECRET ||
      process.env.STRIPE_WEBHOOK_SECRET_PLATFORM ||
      '';


    if (!secret) {
      // Important: sans secret, on NE traite PAS les évènements
      return NextResponse.json(
        { ok: false, error: "missing STRIPE_WEBHOOK_SECRET" },
        { status: 500 }
      );
    }

    // Vérifie et reconstruit l’évènement signé
    let event: any;
    try {
      event = stripe.webhooks.constructEvent(raw, sig, secret);
    } catch (err: any) {
      return NextResponse.json(
        { ok: false, error: `invalid signature: ${err?.message || err}` },
        { status: 400 }
      );
    }

    // (optionnel) si besoin du domaine boutique ailleurs
    const shop = process.env.SHOP_DOMAIN;
    void shop;

    // =========================
    //  IDÉMPOTENCE (anti double)
    // =========================
    // Stripe peut renvoyer le même event. On bloque si déjà traité.
    const redis = getRedis();
    const eventId = event?.id as string | undefined;

    if (eventId) {
      // On garde une trace 7 jours (largement suffisant)
      const key = `stripe:webhook:processed:${eventId}`;
      const firstTime = await redis.set(key, "1", { NX: true, EX: 60 * 60 * 24 * 7 });
      if (firstTime !== "OK") {
        // déjà traité -> répondre 200
        return NextResponse.json({ received: true, dedup: true }, { status: 200 });
      }
    }

    // =========================
    //  ROUTAGE DES ÉVÉNEMENTS
    // =========================
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as any;

        // ======= STATS MARKETFORMATION =======
        // IMPORTANT: pour attribuer au bon formateur, il faut metadata.trainer_id
        const trainerId =
          session?.metadata?.trainer_id ||
          session?.metadata?.trainerId ||
          session?.metadata?.trainer ||
          null;

        if (trainerId) {
          const amountCents = Number(session?.amount_total || 0);

          // 30 jours (simple). On ne fait pas encore de "rolling window" par date ici.
          await redis.incr(`sales:count:30d:${trainerId}`);
          if (amountCents > 0) await redis.incrBy(`sales:revenue:30d:${trainerId}`, amountCents);

          // total (optionnel mais utile)
          await redis.incr(`sales:count:total:${trainerId}`);
          if (amountCents > 0) await redis.incrBy(`sales:revenue:total:${trainerId}`, amountCents);
        }

        // ======= TON EXISTANT (abonnements / sync) =======
        // TODO:
        // - marquer l’utilisateur comme actif si abonnement
        // - enregistrer le customer / subscriptionId
        // - lier au shopifyCustomerId si tu as l’info (metadata, etc.)
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as any;
        void sub;
        // TODO:
        // - sync status plan (active / trialing / past_due / canceled)
        // - enregistrer current_period_end, price id, etc.
        break;
      }

      case "invoice.payment_succeeded":
      case "invoice.payment_failed": {
        const invoice = event.data.object as any;

        // ======= (OPTION) STATS si tu veux compter des paiements invoice =======
        // Si tu veux compter l’invoice dans "revenus", il faut aussi trainer_id en metadata.
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

        // TODO: logging / métriques / email interne si besoin
        void invoice;
        break;
      }

      default: {
        // console.log('[stripe webhook] unhandled event:', event.type);
      }
    }

    // Toujours répondre 200 à Stripe si l’évènement a été accepté/traité
    return NextResponse.json({ received: true }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "webhook_error" }, { status: 400 });
  }
}
