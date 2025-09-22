import { NextRequest, NextResponse } from "next/server";
import stripe from '@/lib/stripe';

export const runtime = "nodejs"; // nÃ©cessaire pour Buffer

function tryConstructEvent(buf: Buffer, sig: string, secret?: string) {
  if (!secret) throw new Error("no secret");
  return stripe.webhooks.constructEvent(buf, sig, secret);
}

export async function POST(req: NextRequest) {
  const sig = req.headers.get("stripe-signature")!;
  const buf = Buffer.from(await req.arrayBuffer());

  let event: any;
  try {
    event = tryConstructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET_PLATFORM);
  } catch {
    try {
      event = tryConstructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET_CONNECT);
    } catch (err: any) {
      return NextResponse.json({ error: "Webhook signature failed: " + err.message }, { status: 400 });
    }
  }

  switch (event.type) {
    case "checkout.session.completed":
      // TODO: marquer l'utilisateur PRO si besoin (Shopify metafield)
      break;
    case "customer.subscription.updated":
    case "invoice.paid":
      // TODO: synchroniser le statut d'abonnement
      break;
    case "account.updated":
      // TODO: mettre Ã  jour charges_enabled pour le formateur
      break;
    default:
      break;
  }
  return NextResponse.json({ received: true });
}

