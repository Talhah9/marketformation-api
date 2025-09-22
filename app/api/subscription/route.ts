// app/api/subscription/route.ts
import { optionsResponse, withCorsJSON } from "@/lib/cors";

// (Facultatif) Si tu utilises Stripe ici, importe et lis le statut réel.
// import Stripe from "stripe";
// const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2024-06-20" });

export const runtime = "nodejs";

export async function OPTIONS() {
  return optionsResponse();
}

/**
 * GET: renvoie un statut d'abonnement "démo".
 * Si tu as les infos client (via cookie, header, etc.), remplace par une vraie lecture Stripe.
 */
export async function GET(_req: Request) {
  // Exemple minimal (à remplacer par ta logique réelle)
  const demo = {
    ok: true,
    plan: "Starter", // "Starter" | "Pro" | "Business"
    renews_at: null, // "2025-10-01T00:00:00.000Z" par ex.
  };
  return withCorsJSON(demo, { status: 200 });
}

/**
 * POST: même chose, mais souvent ton front fait un POST (selon ton implémentation actuelle).
 * Garde GET/POST pour compat.
 */
export async function POST(req: Request) {
  // Exemple: si tu reçois un customerId dans le body → lis Stripe en vrai.
  // const { customerId } = await req.json();
  // const subs = await stripe.subscriptions.list({ customer: customerId, status: "active", limit: 1 });
  // ...

  const demo = {
    ok: true,
    plan: "Starter",
    renews_at: null,
  };
  return withCorsJSON(demo, { status: 200 });
}
