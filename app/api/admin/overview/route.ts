// app/api/admin/overview/route.ts
import { handleOptions, jsonWithCors } from "@/app/api/_lib/cors";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getAdminToken() {
  return (
    process.env.SHOP_ADMIN_TOKEN ||
    process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN ||
    process.env.ADMIN_TOKEN ||
    ""
  );
}
function getShopDomain() {
  return process.env.SHOP_DOMAIN || "";
}

async function shopifyGraphql(query: string, variables?: any) {
  const domain = getShopDomain();
  if (!domain) throw new Error("Missing env SHOP_DOMAIN");

  const endpoint = `https://${domain}/admin/api/2024-07/graphql.json`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": getAdminToken(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query, variables: variables || {} }),
    cache: "no-store",
  });

  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {}
  return { ok: res.ok, status: res.status, json, text };
}

function isAdminReq(req: Request) {
  const email = (req.headers.get("x-mf-admin-email") || "").toLowerCase().trim();
  const allow = (process.env.MF_ADMIN_EMAILS || "talhahally974@gmail.com")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return !!email && allow.includes(email);
}

function toIntSafe(v: any) {
  const n = parseInt(String(v ?? "").trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

function toMoneyLabelEUR(amount: number | null | undefined) {
  if (amount == null || !Number.isFinite(amount as any)) return "—";
  const n = Number(amount);
  return `${n.toFixed(2)} €`;
}

function daysAgoIso(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

/* ===========================
   Stripe helpers
=========================== */
function getStripe(): Stripe {
  const key = (process.env.STRIPE_SECRET_KEY || "").trim();
  if (!key || !key.startsWith("sk_")) throw new Error("Missing STRIPE_SECRET_KEY");
  return new Stripe(key, { apiVersion: "2024-06-20" });
}

function planFromPriceId(priceId: string) {
  const starter = process.env.STRIPE_PRICE_STARTER;
  const pro = process.env.STRIPE_PRICE_PRO;
  const business = process.env.STRIPE_PRICE_BUSINESS;

  if (starter && priceId === starter) return "starter";
  if (pro && priceId === pro) return "pro";
  if (business && priceId === business) return "business";
  return "other";
}

async function stripeComputeSubsAndMrr() {
  // ✅ compte les subscriptions actives et estime le MRR
  // On fait un listing paginé sur subscriptions status=active
  const stripe = getStripe();

  let hasMore = true;
  let startingAfter: string | undefined = undefined;

  let subs_active = 0;
  let subs_starter = 0;
  let subs_pro = 0;
  let subs_business = 0;
  let mrrCents = 0;

  while (hasMore) {
    // ✅ FIX TS7022: ne pas appeler la variable "page"
    const subsPage: Stripe.ApiList<Stripe.Subscription> = await stripe.subscriptions.list({
      status: "active",
      limit: 100,
      starting_after: startingAfter,
      expand: ["data.items.data.price"],
    });

    for (const sub of subsPage.data) {
      subs_active += 1;

      const price = sub.items.data?.[0]?.price as Stripe.Price | null | undefined;
      const priceId = String(price?.id || "");
      const plan = planFromPriceId(priceId);

      if (plan === "starter") subs_starter += 1;
      else if (plan === "pro") subs_pro += 1;
      else if (plan === "business") subs_business += 1;

      // ✅ MRR estimé : si monthly -> unit_amount
      // Si yearly -> divise par 12 (approx)
      const unit = typeof price?.unit_amount === "number" ? price.unit_amount : 0;
      const interval = String(price?.recurring?.interval || "month");
      const intervalCount = Number(price?.recurring?.interval_count || 1);

      if (unit > 0) {
        if (interval === "month") mrrCents += unit * intervalCount;
        else if (interval === "year") mrrCents += Math.round((unit / 12) * intervalCount);
        else mrrCents += unit; // fallback
      }
    }

    hasMore = subsPage.has_more;
    startingAfter = subsPage.data.length ? subsPage.data[subsPage.data.length - 1].id : undefined;
    if (!startingAfter) break;
  }

  return {
    subs_active,
    subs_starter,
    subs_pro,
    subs_business,
    mrr_eur: mrrCents ? mrrCents / 100 : 0,
    mrr_label: mrrCents ? toMoneyLabelEUR(mrrCents / 100) : "—",
  };
}

/* ===========================
   Sales 30d (fallback via Prisma)
   - base: nombre d’achats 30j
   - €: si course.priceCents existe, on calcule, sinon "—"
=========================== */
async function computeSales30dFromPrisma() {
  try {
    const since = daysAgoIso(30);

    const rows = await prisma.studentCourse.findMany({
      where: {
        archived: false,
        purchaseDate: { gte: since },
      },
      select: {
        purchaseDate: true,
        courseId: true,
        course: {
          select: {
            // ⚠️ si ce champ n'existe pas dans ton Prisma schema, ça lèvera => catch safe
            priceCents: true as any,
          } as any,
        } as any,
      } as any,
    });

    const count = rows.length;

    let sumCents = 0;
    let hasPrice = true;

    for (const r of rows as any[]) {
      const pc = r?.course?.priceCents;
      if (typeof pc === "number" && pc >= 0) sumCents += pc;
      else hasPrice = false;
    }

    return {
      sales_30d_count: count,
      sales_30d_eur: hasPrice ? sumCents / 100 : null,
      sales_30d_label: hasPrice ? toMoneyLabelEUR(sumCents / 100) : `(${count})`,
    };
  } catch {
    return {
      sales_30d_count: null,
      sales_30d_eur: null,
      sales_30d_label: "—",
    };
  }
}

export async function OPTIONS(req: Request) {
  return handleOptions(req);
}

export async function GET(req: Request) {
  try {
    if (!process.env.SHOP_DOMAIN || !getAdminToken()) {
      return jsonWithCors(req, { ok: false, error: "Missing SHOP_DOMAIN or admin token" }, { status: 500 });
    }
    if (!isAdminReq(req)) {
      return jsonWithCors(req, { ok: false, error: "admin_forbidden" }, { status: 403 });
    }

    // 1) Shopify KPIs (comme avant)
    const q = `
      query AdminOverview($qCourses: String!, $qTrainers: String!) {
        courses: products(first: 250, query: $qCourses) {
          edges {
            node {
              id
              approval: metafield(namespace:"mfapp", key:"approval_status") { value }
              sales: metafield(namespace:"mfapp", key:"sales_count") { value }
            }
          }
        }
        trainers: customers(first: 250, query: $qTrainers) {
          edges { node { id } }
        }
      }
    `;

    const coursesQuery = `tag:"mkt-course"`;
    const trainerTags = String(process.env.MF_TRAINER_TAGS || "mf_trainer,mkt-trainer")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const trainersQuery =
      trainerTags.length === 1
        ? `tag:${trainerTags[0]}`
        : trainerTags.map((t) => `tag:${t}`).join(" OR ");

    const r = await shopifyGraphql(q, { qCourses: coursesQuery, qTrainers: trainersQuery });
    if (!r.ok) {
      return jsonWithCors(req, { ok: false, error: `Shopify ${r.status}`, detail: r.text }, { status: r.status });
    }

    const coursesEdges = r.json?.data?.courses?.edges || [];
    const trainersEdges = r.json?.data?.trainers?.edges || [];

    let coursesSoldTotal = 0;
    coursesEdges.forEach((e: any) => {
      coursesSoldTotal += toIntSafe(e?.node?.sales?.value);
    });

    // 2) Stripe KPIs
    let stripeKpis = {
      subs_active: "—",
      subs_starter: "—",
      subs_pro: "—",
      subs_business: "—",
      mrr: "—",
      mrr_eur: null as any,
    };

    try {
      const s = await stripeComputeSubsAndMrr();
      stripeKpis = {
        subs_active: s.subs_active,
        subs_starter: s.subs_starter,
        subs_pro: s.subs_pro,
        subs_business: s.subs_business,
        mrr: s.mrr_label,
        mrr_eur: s.mrr_eur,
      } as any;
    } catch (e: any) {
      console.warn("[MF][admin/overview] stripe disabled", e?.message || e);
    }

    // 3) Sales 30d (fallback Prisma)
    const s30 = await computeSales30dFromPrisma();

    return jsonWithCors(req, {
      ok: true,

      trainers_total: trainersEdges.length,
      trainers_approved: "—",
      trainers_pending: "—",

      subs_active: stripeKpis.subs_active,
      subs_starter: stripeKpis.subs_starter,
      subs_pro: stripeKpis.subs_pro,
      subs_business: stripeKpis.subs_business,

      mrr: stripeKpis.mrr,
      mrr_eur: stripeKpis.mrr_eur,

      sales_30d: s30.sales_30d_label,
      sales_30d_eur: s30.sales_30d_eur,
      sales_30d_count: s30.sales_30d_count,

      payouts_pending_count: "—",
      payouts_pending_label: "—",

      courses_sold_total: coursesSoldTotal,
    });
  } catch (e: any) {
    return jsonWithCors(req, { ok: false, error: e?.message || "admin_overview_failed" }, { status: 500 });
  }
}
