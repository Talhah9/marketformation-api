// app/api/courses/route.ts
// Crée un produit "Course" (vendor = email) + liste les courses.
// ✅ Public listing via App Proxy:
// - /apps/mf/courses?u=trainer-<id>&public=1
// - /apps/mf/courses?handle=xxx&public=1 (legacy)
// - ✅ BIGINT safe: jamais Number() sur les IDs Shopify
// - En public=1: uniquement published + APPROUVÉES + pas de quota
//
// ✅ Workflow validation admin (publish gate)
// - À la création: produit = DRAFT + mfapp.approval_status = "pending"
// - La publication réelle + mfapp.published_YYYYMM se fait via endpoint admin approve (hors scope ici)
// - Au listing: renvoie approval_status + approval_label
//
// ✅ LISTING: GraphQL (products + metafields theme + approval_status) en 1 requête
// ✅ COLLECTIONS: tag Shopify: theme-<handle>, collections = automatiques ("tag contient theme-<handle>")
//
// ✅ QUOTAS:
// - Starter = 1 / mois
// - Creator = 3 / mois
//
// ✅ FIX CRITIQUE:
// - Sans abonnement => bloqué (subscription_required)
// - Quota appliqué sur créations mensuelles via Redis
//
// ✅ ADMIN BYPASS QUOTA:
// - ENV: MF_ADMIN_EMAILS="ton@email.com,autre@email.com"
// - Admin reconnu par email (body) OU header x-mf-admin-email
//
// ✅ FIX CRITIQUE (SYNC LISTES):
// - learn/requirements/audience/includes peuvent venir en ARRAY OU en STRING
// - on convertit toujours en tableau
// - on essaye d’écrire JSON
// - si Shopify refuse (type déjà défini en single_line_text_field), fallback en single_line_text_field
//   en stockant la valeur JSON en string (parse côté Liquid/JS)

import { handleOptions, jsonWithCors } from "@/app/api/_lib/cors";
import { prisma } from "@/lib/prisma";
import { getRedis } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ===================== Utils ===================== */
function ym(d = new Date()) {
  return String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, "0");
}

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

/* ===================== ADMIN ===================== */
function parseCsvEnv(name: string) {
  return String(process.env[name] || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function isAdminEmail(email: string | null | undefined) {
  const admins = parseCsvEnv("MF_ADMIN_EMAILS");
  if (!admins.length) return false;
  const e = String(email || "").trim().toLowerCase();
  return !!e && admins.includes(e);
}

function isAdminRequest(req: Request, emailFromBody?: string | null) {
  if (isAdminEmail(emailFromBody)) return true;

  const h = String(req.headers.get("x-mf-admin-email") || "")
    .trim()
    .toLowerCase();

  if (isAdminEmail(h)) return true;

  return false;
}

async function shopifyFetch(path: string, init?: RequestInit & { json?: any }) {
  const domain = getShopDomain();
  if (!domain) throw new Error("Missing env SHOP_DOMAIN");

  const base = `https://${domain}/admin/api/2024-07`;
  const headers: Record<string, string> = {
    "X-Shopify-Access-Token": getAdminToken(),
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  const res = await fetch(base + path, {
    method: init?.method || (init?.json ? "POST" : "GET"),
    headers,
    body: init?.json ? JSON.stringify(init.json) : undefined,
    cache: "no-store",
  });

  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {}

  return { ok: res.ok, status: res.status, json, text };
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

/* ===================== Public handle -> email (BIGINT safe) ===================== */
function extractDigitsHandle(h: string) {
  const s = String(h || "").trim();
  if (!s) return "";
  const m = s.match(/^trainer-(\d+)$/i);
  if (m) return m[1];
  if (/^\d+$/.test(s)) return s;
  return "";
}

function customerGidFromIdDigits(idDigits: string) {
  const d = String(idDigits || "").trim();
  if (!/^\d+$/.test(d)) return "";
  return `gid://shopify/Customer/${d}`;
}

async function resolveEmailByCustomerIdDigits(idDigits: string): Promise<string> {
  const gid = customerGidFromIdDigits(idDigits);
  if (!gid) return "";

  const q = `
    query($id: ID!) {
      customer(id: $id) { email }
    }
  `;
  const r = await shopifyGraphql(q, { id: gid });
  return String(r.json?.data?.customer?.email || "").trim();
}

async function resolveEmailByHandle(handle: string): Promise<string> {
  const h = String(handle || "").trim();
  if (!h) return "";

  const digits = extractDigitsHandle(h);
  if (digits) {
    const email = await resolveEmailByCustomerIdDigits(digits);
    if (email) return email;
  }

  const safe = h.replace(/"/g, '\\"');
  const search = `metafield:mkt.handle:"${safe}" OR tag:"mf_handle:${safe}"`;

  const q = `
    query($search: String!) {
      customers(first: 1, query: $search) {
        edges { node { email } }
      }
    }
  `;
  const r = await shopifyGraphql(q, { search });
  return String(r.json?.data?.customers?.edges?.[0]?.node?.email || "").trim();
}

/* ===================== Labels thématiques ===================== */
const THEME_LABELS: Record<string, string> = {
  "tech-ia": "Tech & IA",
  "business-entrepreneuriat": "Business & Entrepreneuriat",
  "carriere-competences": "Carrière & Compétences",
  "finance-investissement": "Finance & Investissement",
  "creativite-design": "Créativité & Design",
  "developpement-personnel-bien-etre": "Développement perso & Bien-être",
};

/* ===================== Metafields helpers (REST upsert) ===================== */
async function upsertProductMetafield(
  productId: number,
  namespace: string,
  key: string,
  type: string,
  value: string
) {
  return shopifyFetch(`/metafields.json`, {
    json: {
      metafield: {
        namespace,
        key,
        type,
        value,
        owner_resource: "product",
        owner_id: productId,
      },
    },
  });
}

/**
 * ✅ Upsert "smart":
 * - tente d’écrire avec le type voulu
 * - si Shopify refuse parce que la définition impose un autre type (422),
 *   fallback en single_line_text_field (en gardant la valeur JSON stringify)
 */
async function upsertProductMetafieldSmart(
  productId: number,
  namespace: string,
  key: string,
  preferredType: string,
  value: string
) {
  const r1 = await upsertProductMetafield(productId, namespace, key, preferredType, value);

  if (r1.ok) return r1;

  // cas exact que tu as : 422 type mismatch
  const msg = String(r1.text || "");
  const typeMismatch =
    r1.status === 422 &&
    (msg.includes("must be consistent with the definition's type") ||
      msg.includes("definition's type"));

  if (typeMismatch && preferredType === "json") {
    // fallback SURTOUT PAS multi_line si Shopify a défini single_line (sinon re-422)
    const fallbackType = "single_line_text_field";
    const r2 = await upsertProductMetafield(productId, namespace, key, fallbackType, value);

    if (!r2.ok) {
      console.error("[MF] metafield fallback upsert failed:", {
        namespace,
        key,
        preferredType,
        fallbackType,
        status: r2.status,
        text: r2.text,
      });
      throw new Error(`metafield_upsert_failed:${namespace}.${key}:${r2.status}`);
    }

    console.warn("[MF] metafield type mismatch => fallback to single_line_text_field:", {
      namespace,
      key,
    });

    return r2;
  }

  console.error("[MF] metafield upsert failed:", {
    namespace,
    key,
    type: preferredType,
    status: r1.status,
    text: r1.text,
  });
  throw new Error(`metafield_upsert_failed:${namespace}.${key}:${r1.status}`);
}

/* ===================== Subscription plan ===================== */
async function getPlanFromInternalSubscription(
  req: Request,
  email: string
): Promise<"Starter" | "Creator" | "Unknown"> {
  try {
    const u = new URL(req.url);
    const base = `${u.protocol}//${u.host}`;

    const r = await fetch(`${base}/api/subscription`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
      cache: "no-store",
    });

    const data = await r.json().catch(() => ({}));
    const raw = String(data?.planKey || data?.plan || data?.tier || "").toLowerCase();

    if (raw.includes("creator")) return "Creator";
    if (raw.includes("starter")) return "Starter";
    return "Unknown";
  } catch {
    return "Unknown";
  }
}

/* ===================== sanitize helpers for sync fields ===================== */
function cleanStr(v: any, max = 180) {
  return String(v ?? "").trim().slice(0, max);
}

function cleanListAny(v: any, maxItems = 12, maxLen = 180) {
  if (Array.isArray(v)) {
    return v
      .map((x) => cleanStr(x, maxLen))
      .filter(Boolean)
      .slice(0, maxItems);
  }

  const s0 = String(v ?? "").trim();
  if (!s0 || s0 === "null" || s0 === "undefined") return [];

  const tryJsonToArray = (s: string): any[] | null => {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed;
      if (typeof parsed === "string") {
        const inner = parsed.trim();
        if (!inner || inner === "null" || inner === "undefined") return null;
        const parsed2 = JSON.parse(inner);
        if (Array.isArray(parsed2)) return parsed2;
      }
    } catch {}
    return null;
  };

  const parsedArr = tryJsonToArray(s0);
  if (parsedArr) {
    return parsedArr
      .map((x) => cleanStr(x, maxLen))
      .filter(Boolean)
      .slice(0, maxItems);
  }

  const parts = s0.includes("\n")
    ? s0.split("\n")
    : s0.includes(",")
    ? s0.split(",")
    : [s0];

  return parts
    .map((x) => cleanStr(x, maxLen))
    .filter((x) => x && x !== "null" && x !== "undefined")
    .slice(0, maxItems);
}

function cleanModules(arr: any, maxItems = 30) {
  if (!Array.isArray(arr)) return [];
  const out: Array<{ title: string; meta?: string; desc?: string }> = [];
  for (const m of arr) {
    if (typeof m === "string") {
      const t = cleanStr(m, 180);
      if (t) out.push({ title: t });
      continue;
    }
    if (m && typeof m === "object") {
      const title = cleanStr((m as any)?.title, 140);
      const meta = cleanStr((m as any)?.meta, 80);
      const desc = cleanStr((m as any)?.desc, 600);
      if (title) out.push({ title, meta, desc });
    }
  }
  return out.slice(0, maxItems);
}

/* ===================== theme resolve helpers ===================== */
function normalizeThemeHandle(v: any) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(s)) return "";
  return s.toLowerCase();
}
function buildThemeTag(themeHandle: string) {
  const h = normalizeThemeHandle(themeHandle);
  if (!h) return "";
  return `theme-${h}`;
}
function uniqTags(tags: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of tags) {
    const s = String(t || "").trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/* ===================== Quota (Redis) ===================== */
function normalizeEmail(e: any) {
  return String(e || "").trim().toLowerCase();
}

function ownerIdForQuota(params: {
  email: string;
  shopifyCustomerIdRaw?: string;
  handle?: string;
}) {
  const idDigits = String(params.shopifyCustomerIdRaw || "").trim();
  if (idDigits && /^\d+$/.test(idDigits)) return `trainer-${idDigits}`;

  const digitsFromHandle = extractDigitsHandle(String(params.handle || ""));
  if (digitsFromHandle) return `trainer-${digitsFromHandle}`;

  return `email:${normalizeEmail(params.email)}`;
}

async function getQuotaFromRedis(args: {
  plan: "Starter" | "Creator" | "Unknown";
  ownerId: string;
}) {
  const limit = args.plan === "Starter" ? 1 : args.plan === "Creator" ? 3 : 0;
  if (limit <= 0) return { plan: args.plan, limit: null, used: null, remaining: null };

  const redis = getRedis();
  const bucket = ym();
  const key = `quota:created:${bucket}:${args.ownerId}`;
  const used = Number((await redis.get(key)) || 0);

  return {
    plan: args.plan,
    limit,
    used,
    remaining: Math.max(0, limit - used),
    key,
  };
}

/* ===================== OPTIONS (CORS) ===================== */
export async function OPTIONS(req: Request) {
  return handleOptions(req);
}

/* =====================================================================
/* =====================================================================
   GET /api/courses
===================================================================== */
export async function GET(req: Request) {
  try {
    if (!process.env.SHOP_DOMAIN || !getAdminToken()) {
      return jsonWithCors(
        req,
        { ok: false, error: "Missing SHOP_DOMAIN or Admin token" },
        { status: 500 }
      );
    }

    const url = new URL(req.url);

    const handle =
      (url.searchParams.get("u") || "").trim() ||
      (url.searchParams.get("handle") || "").trim();

    const isPublic = url.searchParams.get("public") === "1";

    let email = (url.searchParams.get("email") || "").trim();
    let shopifyCustomerIdRaw = (url.searchParams.get("shopifyCustomerId") || "").trim();

    // ✅ Si on a un handle trainer-<id>, on dérive l'id digits (BIGINT safe)
    const digitsFromHandle = extractDigitsHandle(handle);

    // ✅ En public, si shopifyCustomerId n'est pas fourni mais handle trainer-<id> oui,
    // on utilise cet id pour pouvoir lister SANS email.
    if (!shopifyCustomerIdRaw && digitsFromHandle) {
      shopifyCustomerIdRaw = digitsFromHandle;
    }

    // --------------------------
    // 1) Essaye de résoudre l'email si possible
    // --------------------------
    if (!email && shopifyCustomerIdRaw) {
      email = await resolveEmailByCustomerIdDigits(shopifyCustomerIdRaw);
    }
    if (!email && handle) {
      email = await resolveEmailByHandle(handle);
    }

    // --------------------------
    // 2) Construire la query Shopify (2 stratégies)
    //    A) vendor:"email" (meilleur si dispo)
    //    B) metafield mkt.owner_id:"<idDigits>" (fallback public)
    // --------------------------
    let search = "";

    if (email) {
  const vendor = email.replace(/"/g, '\\"');
  search = `vendor:"${vendor}"`;
} else {
  // ✅ PUBLIC GLOBAL: toutes les formations
  if (isPublic && !shopifyCustomerIdRaw && !handle) {
    search = `tag:"mkt-course"`;
  }
  // ✅ PUBLIC PAR FORMATEUR (owner_id)
  else if (isPublic && shopifyCustomerIdRaw && /^\d+$/.test(shopifyCustomerIdRaw)) {
    const idSafe = shopifyCustomerIdRaw.replace(/"/g, '\\"');
    search = `tag:"mkt-course" AND metafield:mkt.owner_id:"${idSafe}"`;
  }
  // private strict
  else {
    return jsonWithCors(
      req,
      { ok: false, error: "email_or_resolvable_handle_required" },
      { status: 400 }
    );
  }
}


    const q = `
      query($q: String!) {
        products(first: 250, query: $q) {
          edges {
            node {
              id
              title
              handle
              status
              createdAt
              publishedAt
              featuredImage { url }
              theme: metafield(namespace:"mfapp", key:"theme") { value }
              approval: metafield(namespace:"mfapp", key:"approval_status") { value }
              owner_id: metafield(namespace:"mkt", key:"owner_id") { value }
            }
          }
        }
      }
    `;

    const r = await shopifyGraphql(q, { q: search });
    if (!r.ok) {
      return jsonWithCors(
        req,
        { ok: false, error: `Shopify ${r.status}`, detail: r.text },
        { status: r.status }
      );
    }

    const edges = r.json?.data?.products?.edges || [];
    const itemsRaw = edges.map((e: any) => {
      const p = e?.node || {};
      const gid = String(p.id || "");

      const mf_theme = String(p?.theme?.value || "").trim();
      const theme_label = mf_theme && THEME_LABELS[mf_theme] ? THEME_LABELS[mf_theme] : "";

      const approval_status = String(p?.approval?.value || "pending").trim().toLowerCase();
      const approval_label =
        approval_status === "approved"
          ? "Approuvée"
          : approval_status === "rejected"
          ? "Refusée"
          : "En attente";

      const published = !!p.publishedAt;

      return {
        id: gid,
        title: p.title || "",
        coverUrl: p?.featuredImage?.url || "",
        image_url: p?.featuredImage?.url || "",
        published,
        published_at: p.publishedAt || null,
        createdAt: p.createdAt || null,
        mf_theme,
        theme_label,
        url: p.handle ? `/products/${p.handle}` : "",
        handle: p.handle || "",
        approval_status,
        approval_label,
        status: p.status || null,
        owner_id: String(p?.owner_id?.value || "").trim() || null,
      };
    });

    const items = isPublic
      ? itemsRaw.filter((x: any) => !!x.published && x.approval_status === "approved")
      : itemsRaw;

    let plan: "Starter" | "Creator" | "Unknown" = "Unknown";
    let quota: any = null;

    if (!isPublic && email) {
      const admin = isAdminRequest(req, email);

      if (admin) {
        plan = "Creator";
        quota = { plan: "Admin", limit: null, used: null, remaining: null, admin: true };
      } else {
        plan = await getPlanFromInternalSubscription(req, email);

        const ownerId = ownerIdForQuota({ email, shopifyCustomerIdRaw, handle });
        quota = await getQuotaFromRedis({ plan, ownerId });
      }
    }

    return jsonWithCors(req, {
      ok: true,
      items,
      plan,
      quota,
      // debug soft (utile si besoin)
      resolved: {
        isPublic,
        handle: handle || null,
        email: email || null,
        shopifyCustomerIdRaw: shopifyCustomerIdRaw || null,
        search,
      },
    });
  } catch (e: any) {
    return jsonWithCors(req, { ok: false, error: e?.message || "list_failed" }, { status: 500 });
  }
}


/* =====================================================================
   POST /api/courses
===================================================================== */
export async function POST(req: Request) {
  try {
    if (!process.env.SHOP_DOMAIN || !getAdminToken()) {
      return jsonWithCors(
        req,
        { ok: false, error: "Missing SHOP_DOMAIN or Admin token" },
        { status: 500 }
      );
    }

    const url = new URL(req.url);
    const bypassParam = url.searchParams.get("bypassQuota") === "1";

    const body = await req.json().catch(() => ({} as any));
    const {
      email,
      shopifyCustomerId,
      title,
      description,
      imageUrl,
      price,
      pdfUrl: pdfUrlRaw,
      pdf_url,

      status: _statusIgnored,

      theme,
      themeHandle,
      mf_theme,
      collectionHandle,
      collectionHandleOrId,
      collectionId,

      mfapp,

      subtitle,
      learn,
      modules,
      audience,
      duration_text,
      level_text,
      language_text,
      requirements,

      includes,
      includes_text,
    } = body || {};

    // DEBUG: prouver ce que le front envoie
    console.log("[MF] /api/courses payload keys:", Object.keys(body || {}));
    console.log("[MF] /api/courses payload raw lists:", {
      learn: (body as any)?.learn,
      requirements: (body as any)?.requirements,
      audience: (body as any)?.audience,
      includes: (body as any)?.includes,
      includes_text: (body as any)?.includes_text,
      mfapp_keys: (body as any)?.mfapp ? Object.keys((body as any).mfapp) : [],
      mfapp_learn: (body as any)?.mfapp?.learn,
      mfapp_requirements: (body as any)?.mfapp?.requirements,
      mfapp_audience: (body as any)?.mfapp?.audience,
      mfapp_includes: (body as any)?.mfapp?.includes,
    });

    const pdfUrl = String(pdfUrlRaw || pdf_url || "").trim();

    const typeRaw =
  String(mfapp?.type || body?.type || "").trim().toUpperCase();

const isVideo = typeRaw === "VIDEO";

if (!email || !title || !imageUrl || price === undefined || price === null || String(price).trim() === "") {
  return jsonWithCors(
    req,
    { ok: false, error: "missing fields (email,title,imageUrl,price)" },
    { status: 400 }
  );
}

// ✅ PDF requis uniquement si ce n’est pas une VIDEO
if (!isVideo && !pdfUrl) {
  return jsonWithCors(
    req,
    { ok: false, error: "missing fields (pdfUrl)" },
    { status: 400 }
  );
}


    if (!isVideo) {
  if (!/^https?:\/\//i.test(pdfUrl)) {
    return jsonWithCors(req, { ok: false, error: "pdfUrl must be https URL" }, { status: 400 });
  }
}


    const admin = isAdminRequest(req, email);
    const bypass = bypassParam || admin;

    const plan = await getPlanFromInternalSubscription(req, email);
    if (!bypass && plan === "Unknown") {
      return jsonWithCors(
        req,
        {
          ok: false,
          error: "subscription_required",
          message: "Choisir un abonnement pour commencer à publier des formations.",
        },
        { status: 402 }
      );
    }

    const ownerId = ownerIdForQuota({
      email: String(email),
      shopifyCustomerIdRaw: shopifyCustomerId ? String(shopifyCustomerId) : "",
      handle: "",
    });

    const quotaInfo = bypass
      ? { plan, limit: null, used: null, remaining: null, key: null as any }
      : await getQuotaFromRedis({ plan, ownerId });

    if (!bypass && quotaInfo?.limit && quotaInfo.used != null && quotaInfo.used >= quotaInfo.limit) {
      const msg =
        plan === "Starter"
          ? "Quota atteint : 1 formation ce mois-ci (Starter)."
          : "Quota atteint : 3 formations ce mois-ci (Creator).";

      return jsonWithCors(
        req,
        {
          ok: false,
          error: "quota_reached",
          message: msg,
          plan,
          limit: quotaInfo.limit,
          used: quotaInfo.used,
        },
        { status: 403 }
      );
    }

    // normaliser prix Shopify
    let priceStr = "";
    if (price !== undefined && price !== null && String(price).trim() !== "") {
      const n = Number(price);
      if (!Number.isNaN(n) && n >= 0) priceStr = n.toFixed(2);
      else priceStr = String(price).trim();
    }

    const priceNum = Number(String(priceStr || price).replace(",", "."));
if (!Number.isFinite(priceNum) || priceNum < 0) {
  return jsonWithCors(req, { ok: false, error: "invalid price" }, { status: 400 });
}
const priceCents = Math.round(priceNum * 100);


    const themeHandleFinal =
      normalizeThemeHandle(mf_theme) ||
      normalizeThemeHandle(themeHandle) ||
      normalizeThemeHandle(theme) ||
      normalizeThemeHandle(collectionHandle) ||
      normalizeThemeHandle(collectionHandleOrId) ||
      normalizeThemeHandle(collectionId);

    const themeTag = buildThemeTag(themeHandleFinal);

    const finalStatus: "draft" = "draft";

    const productPayload = {
      product: {
        title,
        body_html: description ? `<p>${String(description)}</p>` : "",
        vendor: email,
        images: imageUrl ? [{ src: String(imageUrl) }] : [],
        tags: uniqTags([
          "mkt-course",
          themeTag,
          themeHandleFinal ? `mf_theme:${themeHandleFinal}` : "",
        ]),
        status: finalStatus,
        variants: [
          {
            requires_shipping: false,
            taxable: false,
            ...(priceStr ? { price: priceStr } : {}),
          },
        ],
      },
    };

    const createRes = await shopifyFetch(`/products.json`, { json: productPayload });
    if (!createRes.ok) {
      return jsonWithCors(
        req,
        { ok: false, error: `Shopify ${createRes.status}`, detail: createRes.text },
        { status: createRes.status }
      );
    }

    const created = (createRes.json as any)?.product;
    if (!created?.id) {
      return jsonWithCors(req, { ok: false, error: "create_failed_no_id" }, { status: 500 });
    }

    // mkt
    await upsertProductMetafield(created.id, "mkt", "owner_email", "single_line_text_field", email);
    if (shopifyCustomerId) {
      await upsertProductMetafield(created.id, "mkt", "owner_id", "single_line_text_field", String(shopifyCustomerId));
    }
    if (!isVideo) {
  await upsertProductMetafield(created.id, "mkt", "pdf_url", "url", pdfUrl);
}

    // approval + theme
    await upsertProductMetafield(created.id, "mfapp", "approval_status", "single_line_text_field", "pending");
    if (themeHandleFinal) {
      await upsertProductMetafield(created.id, "mfapp", "theme", "single_line_text_field", themeHandleFinal);
    }

    // image/pdf
    await upsertProductMetafield(created.id, "mfapp", "image_url", "url", String(imageUrl).trim());
    if (!isVideo) {
  await upsertProductMetafield(created.id, "mkt", "pdf_url", "url", pdfUrl);

  await upsertProductMetafield(created.id, "mfapp", "pdf_url", "url", String(pdfUrl).trim());
  await upsertProductMetafield(created.id, "mfapp", "pdfUrl", "url", String(pdfUrl).trim());
} else {
  // optionnel: tu peux explicitement vider un champ texte si tu veux,
  // mais SURTOUT pas type "url" avec valeur vide.
}


    // ✅ Sync fiche produit (Udemy-like)
    try {
      const mf = mfapp && typeof mfapp === "object" ? mfapp : {};

      const subtitleFinal = cleanStr((mf as any).subtitle ?? subtitle, 600);
      const formatFinal = cleanStr((mf as any).format ?? (mf as any).type ?? "", 60);
      const levelFinal = cleanStr((mf as any).level ?? level_text ?? "", 80);

      const durationTextFinal = cleanStr(
        (mf as any).duration_text ?? duration_text ?? (mf as any).duration ?? "",
        80
      );
      const durationCompatFinal = cleanStr(
        (mf as any).duration ?? (mf as any).duration_text ?? duration_text ?? "",
        80
      );

      const certificateTextFinal = cleanStr((mf as any).certificate_text ?? "", 160);
      const badgeTextFinal = cleanStr((mf as any).badge_text ?? "", 160);
      const pill1Final = cleanStr((mf as any).pill_1 ?? "", 160);
      const pill2Final = cleanStr((mf as any).pill_2 ?? "", 160);
      const quickTitleFinal = cleanStr((mf as any).quick_title ?? "", 160);
      const quickFormatFinal = cleanStr((mf as any).quick_format ?? "", 160);
      const quickAccessFinal = cleanStr((mf as any).quick_access ?? "", 160);
      const quickLevelFinal = cleanStr((mf as any).quick_level ?? "", 160);
      const includesTitleFinal = cleanStr((mf as any).includes_title ?? "", 160);
      const footnoteFinal = cleanStr((mf as any).footnote ?? "", 300);

      const learnArr = cleanListAny((mf as any).learn ?? learn, 12, 160);
      const audienceArr = cleanListAny((mf as any).audience ?? audience, 12, 160);
      const includesArr = cleanListAny(
        (mf as any).includes ?? includes ?? (mf as any).includes_text ?? includes_text ?? [],
        12,
        160
      );
      const reqArr = cleanListAny((mf as any).requirements ?? requirements, 10, 160);
      const modulesArr = cleanModules((mf as any).modules ?? modules, 30);

      console.log("[MF] will write lists sizes:", {
        learn: learnArr.length,
        requirements: reqArr.length,
        audience: audienceArr.length,
        includes: includesArr.length,
        modules: modulesArr.length,
      });

      if (subtitleFinal) {
        await upsertProductMetafield(created.id, "mfapp", "subtitle", "multi_line_text_field", subtitleFinal);
      }
      if (formatFinal) {
        await upsertProductMetafield(created.id, "mfapp", "format", "single_line_text_field", formatFinal);
      }
      if (durationCompatFinal) {
        await upsertProductMetafield(created.id, "mfapp", "duration", "single_line_text_field", durationCompatFinal);
      }
      if (durationTextFinal) {
        await upsertProductMetafield(created.id, "mfapp", "duration_text", "single_line_text_field", durationTextFinal);
      }
      if (levelFinal) {
        await upsertProductMetafield(created.id, "mfapp", "level", "single_line_text_field", levelFinal);
      }
      if (language_text && String(language_text).trim()) {
        await upsertProductMetafield(
          created.id,
          "mfapp",
          "language_text",
          "single_line_text_field",
          cleanStr(language_text, 60)
        );
      }
      if (certificateTextFinal) {
        await upsertProductMetafield(created.id, "mfapp", "certificate_text", "single_line_text_field", certificateTextFinal);
      }
      if (badgeTextFinal) {
        await upsertProductMetafield(created.id, "mfapp", "badge_text", "single_line_text_field", badgeTextFinal);
      }
      if (pill1Final) {
        await upsertProductMetafield(created.id, "mfapp", "pill_1", "single_line_text_field", pill1Final);
      }
      if (pill2Final) {
        await upsertProductMetafield(created.id, "mfapp", "pill_2", "single_line_text_field", pill2Final);
      }
      if (quickTitleFinal) {
        await upsertProductMetafield(created.id, "mfapp", "quick_title", "single_line_text_field", quickTitleFinal);
      }
      if (quickFormatFinal) {
        await upsertProductMetafield(created.id, "mfapp", "quick_format", "single_line_text_field", quickFormatFinal);
      }
      if (quickAccessFinal) {
        await upsertProductMetafield(created.id, "mfapp", "quick_access", "single_line_text_field", quickAccessFinal);
      }
      if (quickLevelFinal) {
        await upsertProductMetafield(created.id, "mfapp", "quick_level", "single_line_text_field", quickLevelFinal);
      }
      if (includesTitleFinal) {
        await upsertProductMetafield(created.id, "mfapp", "includes_title", "single_line_text_field", includesTitleFinal);
      }
      if (footnoteFinal) {
        await upsertProductMetafield(created.id, "mfapp", "footnote", "multi_line_text_field", footnoteFinal);
      }

      // ✅ ÉCRITURE "SMART": JSON si possible, sinon fallback single_line_text_field (JSON string)
      await upsertProductMetafieldSmart(created.id, "mfapp", "learn", "json", JSON.stringify(learnArr));
      await upsertProductMetafieldSmart(created.id, "mfapp", "requirements", "json", JSON.stringify(reqArr));
      await upsertProductMetafieldSmart(created.id, "mfapp", "audience", "json", JSON.stringify(audienceArr));
      await upsertProductMetafieldSmart(created.id, "mfapp", "includes", "json", JSON.stringify(includesArr));
      await upsertProductMetafieldSmart(created.id, "mfapp", "modules", "json", JSON.stringify(modulesArr));

      console.log("[MF] parsed lists preview:", {
        learnArr: learnArr.slice(0, 3),
        reqArr: reqArr.slice(0, 3),
        audienceArr: audienceArr.slice(0, 3),
        includesArr: includesArr.slice(0, 3),
      });
    } catch (e) {
      console.error("[MF] sync metafields error", e);
      // on ne bloque pas la création produit, mais tu vois l’erreur dans les logs
    }

    // Prisma (sans casser)
try {
  const shopifyProductId = String(created.id);
  const shopifyProductHandle = created.handle || null;
  const shopifyProductTitle = created.title || title;

  const mfThemeKey = themeHandleFinal || "";
  const categoryLabel = mfThemeKey && THEME_LABELS[mfThemeKey] ? THEME_LABELS[mfThemeKey] : null;

  const accessUrl = shopifyProductHandle ? `/products/${shopifyProductHandle}` : "";

  const mf = mfapp && typeof mfapp === "object" ? mfapp : {};
  const subtitleFinal = String((mf as any).subtitle ?? subtitle ?? "").trim() || (description || null);

  await (prisma as any).course.upsert({
    where: { shopifyProductId },
    update: {
      shopifyProductHandle,
      shopifyProductTitle,
      title,
      subtitle: subtitleFinal,
      imageUrl,
      pdfUrl: isVideo ? "" : pdfUrl,
      accessUrl,
      categoryLabel,
      trainerEmail: email,
      trainerShopifyId: shopifyCustomerId ? String(shopifyCustomerId) : null,
      priceCents, // ✅ NEW
    },
    create: {
      shopifyProductId,
      shopifyProductHandle,
      shopifyProductTitle,
      title,
      subtitle: subtitleFinal,
      imageUrl,
      pdfUrl: isVideo ? "" : pdfUrl,
      accessUrl,
      categoryLabel,
      trainerEmail: email,
      trainerShopifyId: shopifyCustomerId ? String(shopifyCustomerId) : null,
      priceCents, // ✅ NEW
    },
  });
} catch (e) {
  console.error("[MF] prisma.course upsert error", e);
}

    // quota incr
    try {
      if (!bypass && quotaInfo?.key) {
        const redis = getRedis();
        await redis.incr(String(quotaInfo.key));
      }
    } catch (e) {
      console.error("[MF] quota incr error", e);
    }

    return jsonWithCors(req, {
      ok: true,
      id: created.id,
      handle: created.handle,
      admin_url: `https://${process.env.SHOP_DOMAIN}/admin/products/${created.id}`,
      approval_status: "pending",
      status: finalStatus,
      theme: themeHandleFinal || null,
      theme_tag: themeTag || null,
      admin_bypass: admin ? true : undefined,
      plan,
      quota_limit: bypass ? null : (quotaInfo?.limit ?? null),
      quota_used: bypass ? null : (quotaInfo?.used ?? null),
      quota_remaining: bypass ? null : (quotaInfo?.remaining ?? null),
    });
  } catch (e: any) {
    return jsonWithCors(req, { ok: false, error: e?.message || "create_failed" }, { status: 500 });
  }
}

/* helpers legacy (laissés pour compat) */
function mfText(ns: string, key: string, value?: string) {
  const v = (value || "").trim();
  if (!v) return null;
  return { namespace: ns, key, type: "single_line_text_field", value: v };
}
function mfUrl(ns: string, key: string, value?: string) {
  const v = (value || "").trim();
  if (!v) return null;
  return { namespace: ns, key, type: "url", value: v };
}
function mfJson(ns: string, key: string, value: any) {
  if (value == null) return null;
  if (Array.isArray(value) && value.length === 0) return null;
  return { namespace: ns, key, type: "json", value: JSON.stringify(value) };
}
