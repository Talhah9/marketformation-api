import { jsonWithCors, handleOptions } from "@/app/api/_lib/cors";
import { NextResponse } from "next/server";

/** ====== ENV ====== */
const SHOP_DOMAIN = process.env.SHOP_DOMAIN;             // ex: tqiccz-96.myshopify.com
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;             // Admin API access token
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-10";

// Garde-fous PCD (Protected Customer Data)
const ALLOW_EMAIL_LOOKUP   = (process.env.ALLOW_EMAIL_LOOKUP || "false").toLowerCase() === "true";
const ALLOW_ACCOUNT_UPDATE = (process.env.ALLOW_ACCOUNT_UPDATE || "false").toLowerCase() === "true";

export async function OPTIONS(req: Request) {
  return handleOptions(req);
}

/** ====== Utils ====== */
function assertEnv() {
  if (!SHOP_DOMAIN || !ADMIN_TOKEN)
    throw new Error("Missing SHOP_DOMAIN or ADMIN_TOKEN");
}

async function adminGraphQL<T = any>(
  query: string,
  variables?: Record<string, any>
): Promise<T> {
  assertEnv();
  const url = `https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/graphql.json`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": ADMIN_TOKEN!,
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  const j = await r.json();
  if (!r.ok || j?.errors) {
    const msg = j?.errors?.[0]?.message || `Shopify GraphQL error (${r.status})`;
    throw new Error(msg);
  }
  return j.data;
}

const MF_NS = "mf";

function pickPublicMetas(nodes?: Array<{ key: string; value: string }>) {
  const out: Record<string, string> = {};
  for (const n of nodes || []) out[n.key] = n.value;
  return {
    bio: out["bio"] || "",
    avatar_url: out["avatar_url"] || "",
    expertise_url: out["expertise_url"] || "",
  };
}

function toGID(id: string | number) {
  const s = String(id);
  return s.startsWith("gid://") ? s : `gid://shopify/Customer/${s}`;
}

/** ===== Lookups sécurisés (sans PII) ===== */
async function getCustomerMetasById(customerId: string): Promise<{ id: string; metas: { key: string; value: string }[] } | null> {
  const data = await adminGraphQL<{
    customer: {
      id: string;
      metafields: { edges: { node: { key: string; value: string } }[] };
    } | null;
  }>(
    `
    query GetCustomerMetas($id: ID!) {
      customer(id: $id) {
        id
        metafields(first: 20, namespace: "${MF_NS}") {
          edges { node { key value } }
        }
      }
    }`,
    { id: customerId }
  );
  const c = data.customer;
  if (!c) return null;
  return { id: c.id, metas: c.metafields.edges.map(e => e.node) };
}

/** ⚠️ Recherche par email (PII) — désactivée par défaut */
async function getCustomerIdByEmail(email: string): Promise<string | null> {
  if (!ALLOW_EMAIL_LOOKUP) return null;
  const q = `email:"${email.replace(/"/g, '\\"')}"`;
  const data = await adminGraphQL<{ customers: { edges: { node: { id: string } }[] } }>(
    `
    query FindCustomerByEmail($q: String!) {
      customers(first: 1, query: $q) { edges { node { id } } }
    }`,
    { q }
  );
  return data.customers.edges?.[0]?.node?.id || null;
}

/** ====== GET ======
 * Query: ?shopifyCustomerId=123  | (optionnel) ?email=foo@bar.com
 * Renvoie uniquement les metafields publics (pas de PII).
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const idRaw = searchParams.get("shopifyCustomerId") || undefined;
    const email = searchParams.get("email") || undefined;

    if (!idRaw && !email) {
      return jsonWithCors(req, { ok: false, error: "Missing identifier." }, { status: 400 });
    }

    let id: string | null = idRaw ? toGID(idRaw) : null;
    if (!id && email) id = await getCustomerIdByEmail(email);
    if (!id) {
      return jsonWithCors(req, { ok: false, error: ALLOW_EMAIL_LOOKUP ? "Customer not found." : "Email lookup disabled; pass shopifyCustomerId." }, { status: 404 });
    }

    // Lire seulement les METAFIELDS (pas de PII)
    const c = await getCustomerMetasById(id);
    if (!c) return jsonWithCors(req, { ok: false, error: "Customer not found." }, { status: 404 });

    const profile = pickPublicMetas(c.metas);
    return jsonWithCors(req, { ok: true, profile, customer: { id: c.id } });
  } catch (e: any) {
    // Si PCD bloque, renvoyer un message clair + 200 tolérant pour ne pas casser le front
    const msg = String(e?.message || "");
    if (msg.toLowerCase().includes("not approved") || msg.toLowerCase().includes("personally identifiable")) {
      return jsonWithCors(req, { ok: false, error: "pcd_denied: This app cannot access PII fields. Use shopifyCustomerId and metafields only." });
    }
    return jsonWithCors(req, { ok: false, error: msg || "Server error" }, { status: 500 });
  }
}

/** ====== POST ======
 * Body JSON (il faut un identifiant via shopifyCustomerId OU (email si autorisé)):
 * {
 *   shopifyCustomerId?: string, email?: string,
 *   // Métas publics
 *   bio?: string, avatar_url?: string, expertise_url?: string,
 *   // Infos compte (non public) — ignoré si ALLOW_ACCOUNT_UPDATE !== true
 *   firstName?: string, lastName?: string, emailNew?: string, phone?: string
 * }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const idRaw: string | undefined = body.shopifyCustomerId;
    const email: string | undefined = body.email;

    if (!idRaw && !email) {
      return jsonWithCors(req, { ok: false, error: "Missing identifier." }, { status: 400 });
    }

    let customerId: string | null = idRaw ? toGID(idRaw) : null;
    if (!customerId && email) customerId = await getCustomerIdByEmail(email);
    if (!customerId) {
      return jsonWithCors(req, { ok: false, error: ALLOW_EMAIL_LOOKUP ? "Customer not found." : "Email lookup disabled; pass shopifyCustomerId." }, { status: 404 });
    }

    // 1) Update infos compte — optionnel et protégé par flag (évite PCD)
    if (ALLOW_ACCOUNT_UPDATE) {
      const updInput: Record<string, any> = { id: customerId };
      if (typeof body.firstName === "string") updInput.firstName = body.firstName;
      if (typeof body.lastName === "string")  updInput.lastName  = body.lastName;
      if (typeof body.emailNew === "string" && body.emailNew) updInput.email = body.emailNew;
      if (typeof body.phone === "string")     updInput.phone     = body.phone;

      if (Object.keys(updInput).length > 1) {
        const data = await adminGraphQL<{
          customerUpdate: { customer: { id: string } | null; userErrors: { message: string }[] };
        }>(
          `
          mutation UpdateCustomer($input: CustomerInput!) {
            customerUpdate(input: $input) {
              customer { id }
              userErrors { message }
            }
          }`,
          { input: updInput }
        );
        const errs = data.customerUpdate.userErrors;
        if (errs?.length) {
          return jsonWithCors(req, { ok: false, error: errs.map(e => e.message).join("; ") }, { status: 400 });
        }
      }
    }

    // 2) Update métas publics
    const metas: any[] = [];
    if (typeof body.bio === "string")
      metas.push({ ownerId: customerId, namespace: MF_NS, key: "bio", type: "multi_line_text_field", value: body.bio });
    if (typeof body.avatar_url === "string" && body.avatar_url)
      metas.push({ ownerId: customerId, namespace: MF_NS, key: "avatar_url", type: "url", value: body.avatar_url });
    if (typeof body.expertise_url === "string" && body.expertise_url)
      metas.push({ ownerId: customerId, namespace: MF_NS, key: "expertise_url", type: "url", value: body.expertise_url });

    if (metas.length) {
      const data = await adminGraphQL<{
        metafieldsSet: { metafields: { key: string }[]; userErrors: { message: string }[] };
      }>(
        `
        mutation SetMetas($metas: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metas) {
            metafields { key }
            userErrors { message }
          }
        }`,
        { metas }
      );
      const errs = data.metafieldsSet.userErrors;
      if (errs?.length) {
        return jsonWithCors(req, { ok: false, error: errs.map(e => e.message).join("; ") }, { status: 400 });
      }
    }

    // 3) Relire métas et renvoyer (pas de PII)
    const c = await getCustomerMetasById(customerId);
    const profile = pickPublicMetas(c?.metas);
    return jsonWithCors(req, { ok: true, profile, customer: { id: c?.id } });
  } catch (e: any) {
    const msg = String(e?.message || "");
    if (msg.toLowerCase().includes("not approved") || msg.toLowerCase().includes("personally identifiable")) {
      return jsonWithCors(req, { ok: false, error: "pcd_denied: Account update and email lookups are restricted on this store plan." });
    }
    return jsonWithCors(req, { ok: false, error: msg || "Server error" }, { status: 500 });
  }
}
