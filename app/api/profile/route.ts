// app/api/profile/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ============================================================
   CORS
============================================================ */
const DEFAULT_SHOP_ORIGIN =
  process.env.SHOP_DOMAIN
    ? `https://${process.env.SHOP_DOMAIN}`
    : "https://tqiccz-96.myshopify.com";

const ALLOW_ORIGINS: string[] =
  (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

if (!ALLOW_ORIGINS.length && DEFAULT_SHOP_ORIGIN) {
  ALLOW_ORIGINS.push(DEFAULT_SHOP_ORIGIN);
}

const ALLOW_METHODS = "GET, POST, OPTIONS";
const ALLOW_HEADERS = "Content-Type, Authorization, X-Requested-With";

function pickOrigin(req: Request) {
  const o = (req.headers.get("origin") || "").trim();
  return o && ALLOW_ORIGINS.includes(o) ? o : ALLOW_ORIGINS[0] || "";
}

function withCORS(req: Request, res: NextResponse) {
  const origin = pickOrigin(req);
  if (origin) {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set("Access-Control-Allow-Methods", ALLOW_METHODS);
    res.headers.set("Access-Control-Allow-Headers", ALLOW_HEADERS);
    res.headers.set("Vary", "Origin");
  }
  res.headers.set("Cache-Control", "no-store");
  return res;
}

function json(req: Request, data: any, status = 200) {
  return withCORS(
    req,
    new NextResponse(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  );
}

export async function OPTIONS(req: Request) {
  return withCORS(
    req,
    new NextResponse(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Methods": ALLOW_METHODS,
        "Access-Control-Allow-Headers": ALLOW_HEADERS,
      },
    })
  );
}

/* ============================================================
   Types + mémoire
============================================================ */
type Links = {
  website?: string;
  linkedin?: string;
  instagram?: string;
  youtube?: string;
  facebook?: string;
  twitter?: string; // legacy
};

type Profile = {
  // ✅ public key
  handle: string;

  // public fields
  first_name?: string;
  last_name?: string;
  headline?: string;
  bio: string;
  language?: string;
  avatar_url: string;
  expertise_url: string;

  links?: Links;

  // private ids
  email: string;
  shopifyCustomerId: string;

  // legacy
  phone?: string;
  linkedin?: string;
  twitter?: string;
  website?: string;
};

const g = globalThis as any;
if (!g.__MF_PROFILES) g.__MF_PROFILES = {};
const MEMORY: Record<string, Profile> = g.__MF_PROFILES;

function makeKey(email: string, shopifyCustomerId: string) {
  return shopifyCustomerId || email || "anonymous";
}

function getFirst(obj: any, keys: string[]): string {
  if (!obj) return "";
  for (const k of keys) {
    if (obj[k] != null && obj[k] !== "") return String(obj[k]);
  }
  return "";
}

function slugify(s: string) {
  return String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function safeUrl(s: string) {
  const v = String(s || "").trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  return "https://" + v.replace(/^\/+/, "");
}

function urlOrEmpty(s: string) {
  const v = String(s || "").trim();
  if (!v) return "";
  // ✅ on ne "fabrique" pas une URL pour les réseaux : on garde uniquement si déjà URL
  if (/^https?:\/\//i.test(v)) return v;
  return "";
}

/* ============================================================
   Shopify helpers
============================================================ */
function getAdminToken() {
  return (
    process.env.SHOP_ADMIN_TOKEN ||
    process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN ||
    process.env.ADMIN_TOKEN ||
    ""
  );
}

async function shopifyFetch(path: string, init?: RequestInit & { json?: any }) {
  const domain = process.env.SHOP_DOMAIN;
  const token = getAdminToken();
  if (!domain || !token) throw new Error("Missing SHOP_DOMAIN or Admin token");

  const base = `https://${domain}/admin/api/2024-07`;
  const headers: Record<string, string> = {
    "X-Shopify-Access-Token": token,
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
  try { json = text ? JSON.parse(text) : {}; } catch {}
  return { ok: res.ok, status: res.status, json, text };
}

// ✅ Best-effort GraphQL search by metafield handle
async function shopifyGraphql(query: string, variables?: any) {
  const domain = process.env.SHOP_DOMAIN;
  const token = getAdminToken();
  if (!domain || !token) throw new Error("Missing SHOP_DOMAIN or Admin token");

  const endpoint = `https://${domain}/admin/api/2024-07/graphql.json`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query, variables: variables || {} }),
    cache: "no-store",
  });

  const text = await res.text();
  let json: any = {};
  try { json = text ? JSON.parse(text) : {}; } catch {}
  return { ok: res.ok, status: res.status, json, text };
}

async function resolveCustomerId(email: string, shopifyCustomerId?: string): Promise<number | null> {
  if (shopifyCustomerId) {
    const num = Number(shopifyCustomerId);
    if (!Number.isNaN(num)) return num;
  }

  const trimmedEmail = (email || "").trim();
  if (!trimmedEmail) return null;

  const r = await shopifyFetch(
    `/customers/search.json?query=${encodeURIComponent(`email:${trimmedEmail}`)}&limit=1`
  );
  if (!r.ok) return null;

  const customers = (r.json as any)?.customers || [];
  if (!customers[0]?.id) return null;
  return Number(customers[0].id);
}

async function resolveCustomerIdByHandle(handle: string): Promise<number | null> {
  const h = String(handle || "").trim();
  if (!h) return null;

  // ✅ reliable format: trainer-<id>
  const m = h.match(/^trainer-(\d+)$/i);
  if (m) return Number(m[1]);

  // ✅ best-effort: GraphQL metafield search
  const q = `
    query($search: String!) {
      customers(first: 1, query: $search) {
        edges {
          node { id legacyResourceId }
        }
      }
    }
  `;
  const search = `metafield:mkt.handle:'${h}'`;
  const r = await shopifyGraphql(q, { search });
  const edge = r.json?.data?.customers?.edges?.[0]?.node;
  if (edge?.legacyResourceId) return Number(edge.legacyResourceId);

  return null;
}

async function getCustomerMetafields(customerId: number) {
  const mRes = await shopifyFetch(`/customers/${customerId}/metafields.json?limit=250`);
  const arr = (mRes.ok && (mRes.json as any)?.metafields) ? (mRes.json as any).metafields : [];
  const getVal = (key: string) => {
    const mf = arr.find((m: any) => m?.namespace === "mkt" && m?.key === key);
    return (mf?.value ?? "").toString();
  };
  return { arr, getVal };
}

async function getProfileFromCustomer(customerId: number, fallbackEmail: string): Promise<Profile> {
  const cRes = await shopifyFetch(`/customers/${customerId}.json`);
  const customer = (cRes.ok && (cRes.json as any)?.customer) || {};

  const { getVal } = await getCustomerMetafields(customerId);

  const first_name = customer.first_name || "";
  const last_name  = customer.last_name || "";
  const email      = customer.email || fallbackEmail;

  const savedHandle = getVal("handle");
  const handle = (savedHandle || "").trim() || `trainer-${customerId}`;

  return {
    handle,

    bio: getVal("bio"),
    avatar_url: getVal("avatar_url"),
    expertise_url: getVal("expertise_url"),
    headline: getVal("headline"),
    language: getVal("language"),

    links: {
      website: getVal("website"),
      linkedin: getVal("linkedin"),
      instagram: getVal("instagram"),
      youtube: getVal("youtube"),
      facebook: getVal("facebook"),
      twitter: getVal("twitter"),
    },

    email,
    shopifyCustomerId: String(customerId),

    first_name,
    last_name,
    phone: getVal("phone"),
    linkedin: getVal("linkedin"),
    twitter: getVal("twitter"),
    website: getVal("website"),
  };
}

async function upsertCustomerMetafield(customerId: number, key: string, type: string, value: string) {
  return shopifyFetch(`/metafields.json`, {
    json: {
      metafield: {
        namespace: "mkt",
        key,
        type,
        value,
        owner_resource: "customer",
        owner_id: customerId,
      },
    },
  });
}

async function saveProfileToCustomer(customerId: number, profile: Profile) {
  const displayName = `${profile.first_name || ""} ${profile.last_name || ""}`.trim();

  // ✅ ALWAYS stable handle
  const handle = `trainer-${customerId}`;

  const entries: Array<[string, string, string]> = [
    ["handle", "single_line_text_field", handle],
    ["display_name", "single_line_text_field", displayName],
    ["headline", "single_line_text_field", profile.headline || ""],
    ["language", "single_line_text_field", profile.language || ""],

    ["bio", "multi_line_text_field", profile.bio || ""],
    ["avatar_url", "url", profile.avatar_url || ""],
    ["expertise_url", "url", profile.expertise_url || ""],
    ["phone", "single_line_text_field", profile.phone || ""],

    // ✅ website: safeUrl
    ["website", "url", safeUrl(profile.links?.website || profile.website || "")],

    // ✅ socials: ONLY keep if already URL (avoid https://monpseudo)
    ["linkedin", "url", urlOrEmpty(profile.links?.linkedin || profile.linkedin || "")],
    ["instagram", "url", urlOrEmpty(profile.links?.instagram || "")],
    ["youtube", "url", urlOrEmpty(profile.links?.youtube || "")],
    ["facebook", "url", urlOrEmpty(profile.links?.facebook || "")],
    ["twitter", "url", urlOrEmpty(profile.links?.twitter || profile.twitter || "")],
  ];

  for (const [key, type, value] of entries) {
    await upsertCustomerMetafield(customerId, key, type, value || "");
  }
}

/* ============================================================
   GET profil
   - privé: ?email= / ?shopifyCustomerId=
   - public: ?u=trainer-<id> (ou ?handle=)
============================================================ */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    const handle = (url.searchParams.get("handle") || url.searchParams.get("u") || "").trim();
    const shopifyCustomerId = (url.searchParams.get("shopifyCustomerId") || "").trim();
    const email = (url.searchParams.get("email") || "").trim();

    let cid: number | null = null;

    if (handle) {
      cid = await resolveCustomerIdByHandle(handle);
      if (!cid) return json(req, { ok: false, error: "handle_not_found" }, 404);
    } else {
      if (!email && !shopifyCustomerId) {
        return json(req, { ok: false, error: "email_or_customerId_required" }, 400);
      }
      cid = await resolveCustomerId(email, shopifyCustomerId);
      if (!cid) return json(req, { ok: false, error: "customer_not_found" }, 404);
    }

    const profile = await getProfileFromCustomer(cid, email);

    // fallback mémoire (optionnel)
    const memKey = makeKey(profile.email, profile.shopifyCustomerId);
    const mem = MEMORY[memKey] || (profile.email ? MEMORY[profile.email] : undefined);
    if (mem) {
      if (!profile.bio && mem.bio) profile.bio = mem.bio;
      if (!profile.avatar_url && mem.avatar_url) profile.avatar_url = mem.avatar_url;
      if (!profile.headline && mem.headline) profile.headline = mem.headline;
      if (!profile.language && mem.language) profile.language = mem.language;
      if (!profile.links?.website && mem.links?.website) {
        profile.links = { ...(profile.links || {}), website: mem.links.website };
      }
    }

    return json(req, { ok: true, profile }, 200);
  } catch (e: any) {
    return json(req, { ok: false, error: e?.message || "Profile GET failed" }, 500);
  }
}

/* ============================================================
   POST profil (sauvegarde Shopify + mémoire)
============================================================ */
export async function POST(req: Request) {
  try {
    const raw = await req.json().catch(() => ({} as any));
    const body: any = raw.profile && typeof raw.profile === "object" ? raw.profile : raw;

    const email = getFirst(body, ["email", "contact_email"]);
    const shopifyCustomerIdRaw = getFirst(body, ["shopifyCustomerId", "customerId"]);

    if (!email && !shopifyCustomerIdRaw) {
      return json(req, { ok: false, error: "email_or_customerId_required" }, 400);
    }

    const first_name = getFirst(body, ["first_name", "firstName"]);
    const last_name = getFirst(body, ["last_name", "lastName"]);

    const linksFromBody = body.links && typeof body.links === "object" ? body.links : {};

    const profile: Profile = {
      // placeholder handle (will be forced to trainer-<cid>)
      handle: getFirst(body, ["handle", "trainerHandle", "publicHandle"]),

      bio: getFirst(body, ["bio", "description", "about"]),
      avatar_url: getFirst(body, ["avatar_url", "avatarUrl", "image_url", "imageUrl"]),
      expertise_url: getFirst(body, ["expertise_url", "expertiseUrl"]),
      headline: getFirst(body, ["headline"]),
      language: getFirst(body, ["language", "lang"]),

      links: {
        website:
          getFirst(linksFromBody, ["website"]) ||
          getFirst(body, ["website", "site", "website_url"]),
        linkedin:
          getFirst(linksFromBody, ["linkedin"]) ||
          getFirst(body, ["linkedin"]),
        instagram:
          getFirst(linksFromBody, ["instagram"]) ||
          getFirst(body, ["instagram"]),
        youtube:
          getFirst(linksFromBody, ["youtube"]) ||
          getFirst(body, ["youtube"]),
        facebook:
          getFirst(linksFromBody, ["facebook"]) ||
          getFirst(body, ["facebook"]),
        twitter:
          getFirst(linksFromBody, ["twitter"]) ||
          getFirst(body, ["twitter", "x"]),
      },

      email,
      shopifyCustomerId: shopifyCustomerIdRaw,

      first_name,
      last_name,
      phone: getFirst(body, ["phone", "phone_number"]),
      linkedin: getFirst(body, ["linkedin"]),
      twitter: getFirst(body, ["twitter", "x"]),
      website: getFirst(body, ["website", "site", "website_url"]),
    };

    // Shopify save
    const cid = await resolveCustomerId(email, shopifyCustomerIdRaw);
    if (!cid) return json(req, { ok: false, error: "customer_not_found" }, 404);

    // ✅ FORCE stable handle ALWAYS
    profile.handle = `trainer-${cid}`;
    profile.shopifyCustomerId = String(cid);

    await saveProfileToCustomer(cid, profile);

    // mémoire locale fallback
    const memKey = makeKey(email, profile.shopifyCustomerId);
    MEMORY[memKey] = profile;
    if (email) MEMORY[email] = profile;

    return json(req, { ok: true, profile }, 200);
  } catch (e: any) {
    return json(req, { ok: false, error: e?.message || "Profile POST failed" }, 500);
  }
}
