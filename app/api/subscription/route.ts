import { optionsResponse, withCorsJSON } from "@/lib/cors";
// import Stripe from "stripe"; // branche si tu lis l'état réel Stripe

export const runtime = "nodejs";

export async function OPTIONS() {
  return optionsResponse();
}

export async function GET() {
  // TODO: remplacer par lecture réelle Stripe (customer → subscription active)
  return withCorsJSON({ ok: true, plan: "Starter", renews_at: null }, { status: 200 });
}

export async function POST(req: Request) {
  // idem : lecture réelle si besoin
  return withCorsJSON({ ok: true, plan: "Starter", renews_at: null }, { status: 200 });
}
