// app/api/profile/route.ts
import { NextResponse } from "next/server";

/** ====== ENV ====== */
const SHOP_DOMAIN = process.env.SHOP_DOMAIN; // ex: tqiccz-96.myshopify.com
const ADMIN_TOKEN = process.env.ADMIN_TOKEN; // Admin API access token
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-10";
const ORIGIN = process.env.CORS_ORIGIN || "https://tqiccz-96.myshopify.com";

/** ====== CORS helpers ====== */
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin",
};

function withCorsJSON(data: any, init: ResponseInit = {}) {
  return new NextResponse(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...corsHeaders,
      ...(init.headers as any),
    },
  });
}
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
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
    throw new Error(
      j?.errors?.[0]?.message || `Shopify GraphQL error (${r.status})`
    );
  }
  return j.data;
}

const MF_NS = "mf";

/** Mappe les metafields (namespace "mf") vers {bio, avatar_url, expertise_url} */
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

/** Cherche un client par id GID ou par email (retourne id + champs + metas) */
async function findCustomer({
  id,
  email,
}: {
  id?: string;
  email?: string;
}): Promise<
  | {
      id: string;
      firstName: string | null;
      lastName: string | null;
      email: string | null;
      phone: string | null;
      metas: { key: string; value: string }[];
    }
  | null
> {
  if (id) {
    const data = await adminGraphQL<{
      customer: {
        id: string;
        firstName: string | null;
        lastName: string | null;
        email: string | null;
        phone: string | null;
        metafields: { edges: { node: { key: string; value: string } }[] };
      } | null;
    }>(
      `
      query GetCustomer($id: ID!) {
        customer(id: $id) {
          id firstName lastName email phone
          metafields(first: 10, namespace: "${MF_NS}") {
            edges { node { key value } }
          }
        }
      }`,
      { id }
    );
    const c = data.customer;
    if (!c) return null;
    return {
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      email: c.email,
      phone: c.phone,
      metas: c.metafields.edges.map((e) => e.node),
    };
  }

  if (email) {
    const q = `email:"${email.replace(/"/g, '\\"')}"`;
    const data = await adminGraphQL<{
      customers: {
        edges: {
          node: {
            id: string;
            firstName: string | null;
            lastName: string | null;
            email: string | null;
            phone: string | null;
            metafields: { edges: { node: { key: string; value: string } }[] };
          };
        }[];
      };
    }>(
      `
      query FindCustomerByEmail($q: String!) {
        customers(first: 1, query: $q) {
          edges {
            node {
              id firstName lastName email phone
              metafields(first: 10, namespace: "${MF_NS}") {
                edges { node { key value } }
              }
            }
          }
        }
      }`,
      { q }
    );
    const edge = data.customers.edges?.[0];
    if (!edge) return null;
    const c = edge.node;
    return {
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      email: c.email,
      phone: c.phone,
      metas: c.metafields.edges.map((e) => e.node),
    };
  }

  return null;
}

/** ====== GET ======
 * Query params: ?shopifyCustomerId=123 | ?email=foo@bar.com
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const idRaw = searchParams.get("shopifyCustomerId") || undefined;
    const email = searchParams.get("email") || undefined;

    if (!idRaw && !email) {
      return withCorsJSON({ ok: false, error: "Missing identifier." }, { status: 400 });
    }

    const id = idRaw ? toGID(idRaw) : undefined;
    const c = await findCustomer({ id, email });
    if (!c) return withCorsJSON({ ok: false, error: "Customer not found." }, { status: 404 });

    const profile = pickPublicMetas(c.metas);
    return withCorsJSON({
      ok: true,
      profile,
      customer: {
        id: c.id,
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email,
        phone: c.phone,
      },
    });
  } catch (e: any) {
    return withCorsJSON({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}

/** ====== POST ======
 * Body JSON (tout optionnel mais il faut un identifiant):
 * {
 *   shopifyCustomerId?: string, email?: string,
 *   // Métas publics
 *   bio?: string, avatar_url?: string, expertise_url?: string,
 *   // Infos compte (non public)
 *   firstName?: string, lastName?: string, emailNew?: string, phone?: string
 * }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const idRaw: string | undefined = body.shopifyCustomerId;
    const email: string | undefined = body.email;
    if (!idRaw && !email) {
      return withCorsJSON({ ok: false, error: "Missing identifier." }, { status: 400 });
    }

    const found = await findCustomer({ id: idRaw ? toGID(idRaw) : undefined, email });
    if (!found) return withCorsJSON({ ok: false, error: "Customer not found." }, { status: 404 });

    const customerId = found.id;

    // 1) Update infos compte si fourni
    const updInput: Record<string, any> = { id: customerId };
    if (typeof body.firstName === "string") updInput.firstName = body.firstName;
    if (typeof body.lastName === "string") updInput.lastName = body.lastName;
    if (typeof body.emailNew === "string" && body.emailNew) updInput.email = body.emailNew;
    if (typeof body.phone === "string") updInput.phone = body.phone;

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
        return withCorsJSON({ ok: false, error: errs.map((e) => e.message).join("; ") }, { status: 400 });
      }
    }

    // 2) Update métas publics si fourni
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
        return withCorsJSON({ ok: false, error: errs.map((e) => e.message).join("; ") }, { status: 400 });
      }
    }

    // 3) Relire et renvoyer l'état
    const c = await findCustomer({ id: customerId });
    const profile = pickPublicMetas(c?.metas);
    return withCorsJSON({ ok: true, profile, customer: { id: c?.id, firstName: c?.firstName, lastName: c?.lastName, email: c?.email, phone: c?.phone } });
  } catch (e: any) {
    return withCorsJSON({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}
