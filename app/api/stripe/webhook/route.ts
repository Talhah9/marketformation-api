// app/api/stripe/webhook/route.ts
import { NextResponse } from 'next/server';
import stripe from '@/lib/stripe'; // ton init Stripe: new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' })

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Stripe enverra un POST avec un body *brut* (string). On utilise req.text()
// et stripe.webhooks.constructEvent(raw, sig, secret) pour vérifier l’intégrité.

export async function POST(req: Request) {
  try {
    const sig = req.headers.get('stripe-signature');
    if (!sig) {
      return NextResponse.json({ ok: false, error: 'missing stripe-signature' }, { status: 400 });
    }

    const raw = await req.text();
    const secret =
      process.env.STRIPE_WEBHOOK_SECRET ||
      process.env.STRIPE_WEBHOOK_SECRET_PLATFORM ||
      '';

    if (!secret) {
      // Important: sans secret, on NE traite PAS les évènements
      return NextResponse.json({ ok: false, error: 'missing STRIPE_WEBHOOK_SECRET' }, { status: 500 });
    }

    // Vérifie et reconstruit l’évènement signé
    let event: Stripe.Event;
    try {
      // @ts-ignore — si ton type importé est via instance, Stripe.Event vient du SDK
      event = stripe.webhooks.constructEvent(raw, sig, secret);
    } catch (err: any) {
      return NextResponse.json({ ok: false, error: `invalid signature: ${err?.message || err}` }, { status: 400 });
    }

    // (optionnel) si besoin du domaine boutique ailleurs
    const shop = process.env.SHOP_DOMAIN;
    void shop;

    // =========================
    //  ROUTAGE DES ÉVÉNEMENTS
    // =========================
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as any;
        // TODO:
        // - marquer l’utilisateur comme actif si abonnement
        // - enregistrer le customer / subscriptionId
        // - lier au shopifyCustomerId si tu as l’info (metadata, etc.)
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as any;
        // TODO:
        // - sync status plan (active / trialing / past_due / canceled)
        // - enregistrer current_period_end, price id, etc.
        break;
      }

      case 'invoice.payment_succeeded':
      case 'invoice.payment_failed': {
        const invoice = event.data.object as any;
        // TODO: logging / métriques / email interne si besoin
        break;
      }

      default: {
        // Pour debug: on peut journaliser les types non gérés
        // console.log('[stripe webhook] unhandled event:', event.type);
      }
    }

    // Toujours répondre 200 à Stripe si l’évènement a été accepté/traité
    return NextResponse.json({ received: true }, { status: 200 });
  } catch (e: any) {
    // Toute erreur serveur → 400/500 selon le cas
    return NextResponse.json(
      { ok: false, error: e?.message || 'webhook_error' },
      { status: 400 }
    );
  }
}
