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
// ✅ QUOTAS (règle demandée):
// - Starter = 1 / mois
// - Creator = 3 / mois
//
// ✅ FIX CRITIQUE:
// - Sans abonnement => bloqué (subscription_required)
// - Quota appliqué sur créations mensuelles via Redis (fiable même si DRAFT + pending)
//
// ✅ ADMIN BYPASS QUOTA:
// - ENV: MF_ADMIN_EMAILS="ton@email.com,autre@email.com"
// - Admin reconnu par email (body) OU header x-mf-admin-email
// - Si admin => quota illimité + bypass quota à la création
//
// ✅ FIX SYNC METAFIELDS:
// - On écrit les metafields produit via GraphQL metafieldsSet (fiable) au lieu de REST /metafields.json
//   => corrige le cas où Liquid voit "" pour learn/requirements/audience/includes/subtitle...

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

/**
 * Admin reconnu si:
 * - email du body est admin
 * - OU header x-mf-admin-email est admin
 */
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

/* ===================== Metafields helpers (GraphQL set - ROBUST) ===================== */
async function setProductMetafieldsGQL(
  productGid: string,
  fields: Array<{ namespace: string; key: string; type: string; value: string }>
) {
  const mutation = `
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { namespace key type value }
        userErrors { field message code }
      }
    }
  `;

  const variables = {
    metafields: fields.map((f) => ({
      ownerId: productGid,
      namespace: f.namespace,
      key: f.key,
      type: f.type,
      value: f.value,
    })),
  };

  const r = await shopifyGraphql(mutation, variables);

  const errs = r.json?.data?.metafieldsSet?.userErrors || [];
  if (!r.ok || (Array.isArray(errs) && errs.length)) {
    console.error("[MF] metafieldsSet errors:", errs, "status:", r.status, "text:", r.text);
  }

  return r;
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

  // 1) trainer-<id> or numeric => direct customer lookup
  const digits = extractDigitsHandle(h);
  if (digits) {
    const email = await resolveEmailByCustomerIdDigits(digits);
    if (email) return email;
  }

  // 2) GraphQL search by metafield mkt.handle OR legacy tag mf_handle:<handle>
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

/* ===================== Subscription plan ===================== */
/**
 * Aligne avec ton /api/subscription qui renvoie planKey: "starter" | "creator"
 */
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
function cleanList(arr: any, maxItems = 12, maxLen = 180) {
  if (!Array.isArray(arr)) return [];
  const out = arr.map((x) => cleanStr(x, maxLen)).filter(Boolean);
  return out.slice(0, maxItems);
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

function ownerIdForQuota(params: { email: string; shopifyCustomerIdRaw?: string; handle?: string }) {
  // On privilégie Shopify Customer ID (stable)
  const idDigits = String(params.shopifyCustomerIdRaw || "").trim();
  if (idDigits && /^\d+$/.test(idDigits)) return `trainer-${idDigits}`;

  // fallback: u=trainer-<digits> ou u=<digits>
  const digitsFromHandle = extractDigitsHandle(String(params.handle || ""));
  if (digitsFromHandle) return `trainer-${digitsFromHandle}`;

  // fallback email (stable si bien normalisé)
  return `email:${normalizeEmail(params.email)}`;
}

async function getQuotaFromRedis(args: { plan: "Starter" | "Creator" | "Unknown"; ownerId: string }) {
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
   GET /api/courses
===================================================================== */
export async function GET(req: Request) {
  try {
    if (!process.env.SHOP_DOMAIN || !getAdminToken()) {
      return jsonWithCors(req, { ok: false, error: "Missing SHOP_DOMAIN or Admin token" }, { status: 500 });
    }

    const url = new URL(req.url);

    const handle =
      (url.searchParams.get("u") || "").trim() || (url.searchParams.get("handle") || "").trim();

    const isPublic = url.searchParams.get("public") === "1";

    let email = (url.searchParams.get("email") || "").trim();
    const shopifyCustomerIdRaw = (url.searchParams.get("shopifyCustomerId") || "").trim();

    if (!email && shopifyCustomerIdRaw) {
      email = await resolveEmailByCustomerIdDigits(shopifyCustomerIdRaw);
    }
    if (!email && handle) {
      email = await resolveEmailByHandle(handle);
    }

    if (!email) {
      return jsonWithCors(req, { ok: false, error: "email_or_resolvable_handle_required" }, { status: 400 });
    }

    const vendor = email.replace(/"/g, '\\"');
    const search = `vendor:"${vendor}"`;

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
        approval_status === "approved" ? "Approuvée" : approval_status === "rejected" ? "Refusée" : "En attente";

      const published = !!p.publishedAt;

      return {
        id: gid, // BIGINT safe
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
      };
    });

    const items = isPublic ? itemsRaw.filter((x: any) => !!x.published && x.approval_status === "approved") : itemsRaw;

    // Quota info (uniquement privé)
    let plan: "Starter" | "Creator" | "Unknown" = "Unknown";
    let quota: any = null;

    if (!isPublic && email) {
      const admin = isAdminRequest(req, email);

      if (admin) {
        plan = "Creator"; // pour l'UI, mais admin=true
        quota = { plan: "Admin", limit: null, used: null, remaining: null, admin: true };
      } else {
        plan = await getPlanFromInternalSubscription(req, email);

        // ✅ Quota aligné sur le vrai blocage (Redis, créations du mois)
        const ownerId = ownerIdForQuota({ email, shopifyCustomerIdRaw, handle });
        quota = await getQuotaFromRedis({ plan, ownerId });
      }
    }

    return jsonWithCors(req, { ok: true, items, plan, quota });
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
      return jsonWithCors(req, { ok: false, error: "Missing SHOP_DOMAIN or Admin token" }, { status: 500 });
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

      // status ignoré (publish gate)
      status: _statusIgnored,

      // thématique
      theme,
      themeHandle,
      mf_theme,
      collectionHandle, // legacy
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
    } = body || {};

    const pdfUrl = String(pdfUrlRaw || pdf_url || "").trim();

    if (!email || !title || !imageUrl || !pdfUrl) {
      return jsonWithCors(req, { ok: false, error: "missing fields" }, { status: 400 });
    }

    if (!/^https?:\/\//i.test(pdfUrl)) {
      return jsonWithCors(req, { ok: false, error: "pdfUrl must be https URL" }, { status: 400 });
    }

    // ✅ bypass admin auto (email body OU header) + bypass param manuel
    const admin = isAdminRequest(req, email);
    const bypass = bypassParam || admin;

    // ✅ Abonnement requis (sauf admin/bypass)
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

    // ✅ Quota (Starter=1, Creator=3) basé sur créations du mois via Redis
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
        { ok: false, error: "quota_reached", message: msg, plan, limit: quotaInfo.limit, used: quotaInfo.used },
        { status: 403 }
      );
    }

    // normaliser prix Shopify (string "12.34")
    let priceStr = "";
    if (price !== undefined && price !== null && String(price).trim() !== "") {
      const n = Number(price);
      if (!Number.isNaN(n) && n >= 0) priceStr = n.toFixed(2);
      else priceStr = String(price).trim();
    }

    // ✅ thème final (source de vérité = handle-like)
    const themeHandleFinal =
      normalizeThemeHandle(mf_theme) ||
      normalizeThemeHandle(themeHandle) ||
      normalizeThemeHandle(theme) ||
      normalizeThemeHandle(collectionHandle) ||
      normalizeThemeHandle(collectionHandleOrId) ||
      normalizeThemeHandle(collectionId);

    const themeTag = buildThemeTag(themeHandleFinal);

    // ✅ Publish gate: toujours draft à la création
    const finalStatus: "draft" = "draft";

    /* Création produit */
    const productPayload = {
      product: {
        title,
        body_html: description ? `<p>${String(description)}</p>` : "",
        vendor: email,
        images: imageUrl ? [{ src: String(imageUrl) }] : [],
        tags: uniqTags(["mkt-course", themeTag, themeHandleFinal ? `mf_theme:${themeHandleFinal}` : ""]),
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

    const productGid = `gid://shopify/Product/${created.id}`;

    // ✅ Metafields (ROBUST) via GraphQL
    try {
      const mf = mfapp && typeof mfapp === "object" ? mfapp : {};

      const subtitleFinal = cleanStr((mf as any).subtitle ?? subtitle, 600);

      const formatFinal = cleanStr((mf as any).format ?? "", 60);
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

      const learnArr = cleanList((mf as any).learn ?? learn, 12, 160);
      const audienceArr = cleanList((mf as any).audience ?? audience, 12, 160);
      const includesArr = cleanList((mf as any).includes ?? [], 12, 160);
      const reqArr = cleanList((mf as any).requirements ?? requirements, 10, 160);
      const modulesArr = cleanModules((mf as any).modules ?? modules, 30);

      const fields: Array<{ namespace: string; key: string; type: string; value: string }> = [];

      // ---- mkt namespace (utilisé ailleurs)
      fields.push({ namespace: "mkt", key: "owner_email", type: "single_line_text_field", value: String(email).trim() });
      if (shopifyCustomerId) {
        fields.push({
          namespace: "mkt",
          key: "owner_id",
          type: "single_line_text_field",
          value: String(shopifyCustomerId),
        });
      }
      fields.push({ namespace: "mkt", key: "pdf_url", type: "url", value: String(pdfUrl).trim() });

      // ---- mfapp: gate + theme
      fields.push({ namespace: "mfapp", key: "approval_status", type: "single_line_text_field", value: "pending" });
      if (themeHandleFinal) {
        fields.push({ namespace: "mfapp", key: "theme", type: "single_line_text_field", value: themeHandleFinal });
      }

      // ---- mfapp: urls (source de vérité page produit)
      fields.push({ namespace: "mfapp", key: "image_url", type: "url", value: String(imageUrl).trim() });
      fields.push({ namespace: "mfapp", key: "pdf_url", type: "url", value: String(pdfUrl).trim() });

      // compat (si ton front les utilise encore)
      fields.push({ namespace: "mfapp", key: "imageUrl", type: "url", value: String(imageUrl).trim() });
      fields.push({ namespace: "mfapp", key: "pdfUrl", type: "url", value: String(pdfUrl).trim() });

      // ---- mfapp: texte
      if (subtitleFinal) fields.push({ namespace: "mfapp", key: "subtitle", type: "multi_line_text_field", value: subtitleFinal });
      if (formatFinal) fields.push({ namespace: "mfapp", key: "format", type: "single_line_text_field", value: formatFinal });
      if (levelFinal) fields.push({ namespace: "mfapp", key: "level", type: "single_line_text_field", value: levelFinal });

      if (durationCompatFinal) fields.push({ namespace: "mfapp", key: "duration", type: "single_line_text_field", value: durationCompatFinal });
      if (durationTextFinal) fields.push({ namespace: "mfapp", key: "duration_text", type: "single_line_text_field", value: durationTextFinal });

      if (language_text && String(language_text).trim()) {
        fields.push({ namespace: "mfapp", key: "language_text", type: "single_line_text_field", value: cleanStr(language_text, 60) });
      }

      if (certificateTextFinal) fields.push({ namespace: "mfapp", key: "certificate_text", type: "single_line_text_field", value: certificateTextFinal });
      if (badgeTextFinal) fields.push({ namespace: "mfapp", key: "badge_text", type: "single_line_text_field", value: badgeTextFinal });
      if (pill1Final) fields.push({ namespace: "mfapp", key: "pill_1", type: "single_line_text_field", value: pill1Final });
      if (pill2Final) fields.push({ namespace: "mfapp", key: "pill_2", type: "single_line_text_field", value: pill2Final });

      if (quickTitleFinal) fields.push({ namespace: "mfapp", key: "quick_title", type: "single_line_text_field", value: quickTitleFinal });
      if (quickFormatFinal) fields.push({ namespace: "mfapp", key: "quick_format", type: "single_line_text_field", value: quickFormatFinal });
      if (quickAccessFinal) fields.push({ namespace: "mfapp", key: "quick_access", type: "single_line_text_field", value: quickAccessFinal });
      if (quickLevelFinal) fields.push({ namespace: "mfapp", key: "quick_level", type: "single_line_text_field", value: quickLevelFinal });

      if (includesTitleFinal) fields.push({ namespace: "mfapp", key: "includes_title", type: "single_line_text_field", value: includesTitleFinal });
      if (footnoteFinal) fields.push({ namespace: "mfapp", key: "footnote", type: "multi_line_text_field", value: footnoteFinal });

      // ---- mfapp: JSON lists (LE point critique)
      if (learnArr.length) fields.push({ namespace: "mfapp", key: "learn", type: "json", value: JSON.stringify(learnArr) });
      if (modulesArr.length) fields.push({ namespace: "mfapp", key: "modules", type: "json", value: JSON.stringify(modulesArr) });
      if (audienceArr.length) fields.push({ namespace: "mfapp", key: "audience", type: "json", value: JSON.stringify(audienceArr) });
      if (includesArr.length) fields.push({ namespace: "mfapp", key: "includes", type: "json", value: JSON.stringify(includesArr) });
      if (reqArr.length) fields.push({ namespace: "mfapp", key: "requirements", type: "json", value: JSON.stringify(reqArr) });

      await setProductMetafieldsGQL(productGid, fields);
    } catch (e) {
      console.error("[MF] sync metafields (GQL) error", e);
    }

    // Prisma (on garde ta logique, sans casser)
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
          pdfUrl,
          accessUrl,
          categoryLabel,
          trainerEmail: email,
          trainerShopifyId: shopifyCustomerId ? String(shopifyCustomerId) : null,
        },
        create: {
          shopifyProductId,
          shopifyProductHandle,
          shopifyProductTitle,
          title,
          subtitle: subtitleFinal,
          imageUrl,
          pdfUrl,
          accessUrl,
          categoryLabel,
          trainerEmail: email,
          trainerShopifyId: shopifyCustomerId ? String(shopifyCustomerId) : null,
        },
      });
    } catch (e) {
      console.error("[MF] prisma.course upsert error", e);
    }

    // ✅ Incr quota (créations du mois) après succès Shopify+metafields
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
