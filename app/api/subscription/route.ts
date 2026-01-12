// app/api/subscription/route.ts
import Stripe from "stripe";
import { jsonWithCors, handleOptions } from "@/app/api/_lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function hasStripe(): boolean {
  const k = (process.env.STRIPE_SECRET_KEY || "").trim();
  return !!k && k.startsWith("sk_");
}

const PRICE_TO_PLAN: Record<string, "starter" | "creator"> = {
  [process.env.STRIPE_PRICE_STARTER || ""]: "starter",
  [process.env.STRIPE_PRICE_CREATOR || ""]: "creator",
};

type SubInfo = {
  planKey: "starter" | "creator" | null;
  status: string | null;
  currentPeriodEnd: number | null; // epoch seconds
};

async function getPlanFor({
  email,
  shopifyCustomerId,
}: {
  email?: string;
  shopifyCustomerId?: string | number;
}): Promise<SubInfo> {
  if (!hasStripe()) return { planKey: null, status: null, currentPeriodEnd: null };

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, { apiVersion: "2024-06-20" });

  // 1) Retrouver customer
  let customer: Stripe.Customer | null = null;

  if (shopifyCustomerId) {
    const list = await stripe.customers.search({
      query: `metadata['shopify_customer_id']:'${String(shopifyCustomerId)}'`,
      limit: 1,
    });
    customer = list.data[0] || null;
  }

  if (!customer && email) {
    const list = await stripe.customers.list({ email, limit: 1 });
    customer = list.data[0] || null;
  }

  if (!customer) return { planKey: null, status: null, currentPeriodEnd: null };

  // 2) Abonnements
  const subs = await stripe.subscriptions.list({
    customer: customer.id,
    status: "all",
    limit: 10,
    expand: ["data.items.data.price"],
  });

  const preferred =
    subs.data.find((s) => ["active", "trialing", "past_due", "unpaid"].includes(s.status)) ||
    subs.data[0];

  if (!preferred) return { planKey: null, status: null, currentPeriodEnd: null };

  const item = preferred.items?.data?.[0];
  const priceId = item?.price?.id || "";

  const planKey = PRICE_TO_PLAN[priceId] || null;

  return {
    planKey,
    status: preferred.status || null,
    currentPeriodEnd: preferred.current_period_end || null,
  };
}

export async function OPTIONS(req: Request) {
  return handleOptions(req);
}

export async function POST(req: Request) {
  try {
    const { email, shopifyCustomerId } = await req.json().catch(() => ({}));
    if (!email && !shopifyCustomerId) {
      return jsonWithCors(req, { ok: false, error: "email or shopifyCustomerId required" }, { status: 400 });
    }

    const s = await getPlanFor({ email, shopifyCustomerId });

    return jsonWithCors(req, { ok: true, ...s }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return jsonWithCors(req, { ok: false, error: e?.message || "subscription_failed" }, { status: 500 });
  }
}
