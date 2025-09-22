// app/api/subscription/route.ts
import Stripe from "stripe";
import { handleOptions, jsonWithCors } from "@/app/api/_lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2024-06-20" });

const STORE = process.env.SHOPIFY_STORE_DOMAIN!;
const TOKEN = process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN!;
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-07";

type PlanKey = "starter" | "pro" | "business" | null;

function mapPriceId(priceId?: string | null): PlanKey {
  if (!priceId) return null;
  const map: Record<string, PlanKey> = {
    [process.env.STRIPE_PRICE_STARTER ?? ""]:"starter",
    [process.env.STRIPE_PRICE_PRO ?? ""]:"pro",
    [process.env.STRIPE_PRICE_BUSINESS ?? ""]:"business",
  };
  return map[priceId] ?? null;
}

function inferPlanKey(p: Stripe.Price): PlanKey {
  const name = `${p.nickname || ""} ${(typeof p.product !== "string" && p.product?.name) || ""}`.toLowerCase();
  if (name.includes("starter")) return "starter";
  if (name.includes("pro")) return "pro";
  if (name.includes("business") || name.includes("entreprise")) return "business";
  switch (p.unit_amount) {
    case 1990: return "starter";
    case 3990: return "pro";
    case 6990: return "business";
    default: return null;
  }
}

async function getShopifyCustomerEmail(id: number | string): Promise<string | null> {
  try {
    const url = `https://${STORE}/admin/api/${API_VERSION}/customers/${id}.json`;
    const r = await fetch(url, { headers: { "X-Shopify-Access-Token": TOKEN, "Accept":"application/json" }, cache:"no-store" });
    if (!r.ok) return null;
    const j = await r.json().catch(()=> ({}));
    return j?.customer?.email ?? null;
  } catch { return null; }
}

export async function OPTIONS(req: Request) { return handleOptions(req); }

export async function POST(req: Request) {
  try {
    const { shopifyCustomerId, email } = await req.json().catch(()=> ({} as any));
    let customerEmail: string | null = email || null;
    if (!customerEmail && shopifyCustomerId) customerEmail = await getShopifyCustomerEmail(shopifyCustomerId);
    if (!customerEmail) return jsonWithCors(req, { status: "none", reason: "no_email" });

    const list = await stripe.customers.list({ email: customerEmail, limit: 1 });
    const customer = list.data[0];
    if (!customer) return jsonWithCors(req, { status: "none", reason: "no_customer" });

    const subs = await stripe.subscriptions.list({
      customer: customer.id, status: "all", expand: ["data.items.data.price"], limit: 10
    });
    const active = subs.data.find(s => ["active","trialing","past_due","unpaid"].includes(s.status));
    if (!active) return jsonWithCors(req, { status: "none", reason: "no_active_sub" });

    const price = active.items.data[0]?.price as Stripe.Price | undefined;
    const priceId = price?.id ?? null;

    let planKey: PlanKey = mapPriceId(priceId);
    if (!planKey && active.metadata?.plan_from_price) planKey = mapPriceId(active.metadata.plan_from_price);
    if (!planKey && price) {
      planKey = inferPlanKey(price);
      if (!planKey && priceId) {
        const pr = await stripe.prices.retrieve(priceId, { expand: ["product"] });
        planKey = inferPlanKey(pr as any);
      }
    }

    return jsonWithCors(req, {
      status: active.status, planKey,
      currentPeriodEnd: active.current_period_end * 1000,
      customerId: customer.id, priceId
    });
  } catch (err: any) {
    const msg = err?.raw?.message || err?.message || "subscription_failed";
    return jsonWithCors(req, { status: "none", error: msg });
  }
}
