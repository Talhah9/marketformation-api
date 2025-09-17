// app/api/profile/route.ts
import { NextResponse } from "next/server";
import { handleOptions, jsonWithCors } from "@/app/api/_lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ====== ENV (compat) ====== */
const STORE =
  process.env.SHOPIFY_STORE_DOMAIN ||
  process.env.SHOP_DOMAIN ||
  "";
const TOKEN =
  process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN ||
  process.env.ADMIN_TOKEN ||
  "";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-10";

/** ====== Utils ====== */
function assertEnv() {
  if (!STORE || !TOKEN) {
    throw new Error("Missing SHOPIFY_STORE_DOMAIN/SHOP_DOMAIN or SHOPIFY_ADMIN_API_ACCESS_TOKEN/ADMIN_TOKEN");
  }
}

async function adminGraphQL<T = any>(
  query: string,
  variables?: Record<string, any>
): Promise<T> {
  assertEnv();
  const url = `https://${STORE}/admin/api/${API_VERSION}/graphql.json`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": TOKEN,
      "Accept": "application/json",
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  const text = await r.text();
  let j: any = {};
  try { j = text ? JSON.parse(text) : {}; } catch {}
  if (!r.ok || j?.errors) {
    throw new Error(j?.errors?.[0]?.message || `Shopify GraphQL error (${r.status})`);
  }
  return j.data;
}

const MF_NS = "mf";
function toGID(id: string | number) {
  const s = String(id);
  return s.startsWith("gid://") ? s : `gid://shopify/Customer/${s}`;
}

function pickPublicMetas(nodes?: Array<{ key: string; value: string }>) {
  const out: Record<string, string> = {};
  for (const n of nodes || []) out[n.key] = n.value;
  return {
    bio: out["bio"] || "",
    avatar_url: out["avatar_url"] || "",
    expertise_url: out["expertise_url"] || "",
  };
}

async function findCustomer(opts: { id?: string; email?: string }): Promise<{
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  metas: { key: string; value: string }[];
} | null> {
  if (opts.id) {
    const data = await adminGraphQL<{
      customer: {
        id: string; firstName: string | null; lastName: string | null; email: string | null; phone: string | null;
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
      { id: opts.id }
    );
    const c = data.customer;
    if (!c) return null;
    return {
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      email: c.email,
      phone: c.phone,
      metas: c.metafields.edges.map(e => e.node),
    };
  }

  if (opts.email) {
    const q = `email:"${opts.email.replace(/"/g, '\\"')}"`;
    const data = await adminGraphQL<{
      customers: { edges: { node: {
        id: string; firstName: string | null; lastName: string | null; email: string | null; phone: string | null;
        metafields: { edges: { node: { key: string; value: string } }[] };
      } }[] };
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
      metas: c.metafields.edges.map(e => e.node),
    };
  }

  return null;
}

/** ---------- CORS preflight ---------- */
export async function OPTIONS(req: Request) {
  return handleOptions(req);
}

/** ---------- GET /api/profile?shopifyCustomerId=123 | ?email=foo@bar.com ---------- */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const idRaw = searchParams.get("shopifyCustomerId") || undefined;
    const email = searchParams.get("email") || undefined;

    if (!idRaw && !email) {
      return jsonWithCors(req, { ok: false, error: "Missing identifier." }, { status: 400 });
    }

    const id = idRaw ? toGID(idRaw) : undefined;
    const c = await findCustomer({ id, email });
    if (!c) return jsonWithCors(req, { ok: false, error: "Customer not found." }, { status: 404 });

    const profile = pickPublicMetas(c.metas);
    return jsonWithCors(req, {
      ok: true,
      profile,
      customer: { id: c.id, firstName: c.firstName, lastName: c.lastName, email: c.email, phone: c.phone },
    });
  } catch (e: any) {
    return jsonWithCors(req, { ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}

/** ---------- POST /api/profile ----------
 * Body JSON (id ou email requis):
 * {
 *   shopifyCustomerId?: string, email?: string,
 *   // Métas publics
 *   bio?: string, avatar_url?: string, expertise_url?: string,
 *   // Infos compte
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

    const found = await findCustomer({ id: idRaw ? toGID(idRaw) : undefined, email });
    if (!found) return jsonWithCors(req, { ok: false, error: "Customer not found." }, { status: 404 });

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
        return jsonWithCors(req, { ok: false, error: errs.map(e => e.message).join("; ") }, { status: 400 });
      }
    }

    // 2) Update métas publics si fourni
    const metas: any[] = [];
    if (typeof body.bio === "string") {
      metas.push({ ownerId: customerId, namespace: MF_NS, key: "bio", type: "multi_line_text_field", value: body.bio });
    }
    if (typeof body.avatar_url === "string" && body.avatar_url) {
      metas.push({ ownerId: customerId, namespace: MF_NS, key: "avatar_url", type: "url", value: body.avatar_url });
    }
    if (typeof body.expertise_url === "string" && body.expertise_url) {
      metas.push({ ownerId: customerId, namespace: MF_NS, key: "expertise_url", type: "url", value: body.expertise_url });
    }

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

    // 3) Relire et renvoyer
    const c = await findCustomer({ id: customerId });
    const profile = pickPublicMetas(c?.metas);
    return jsonWithCors(req, {
      ok: true,
      profile,
      customer: { id: c?.id, firstName: c?.firstName, lastName: c?.lastName, email: c?.email, phone: c?.phone },
    });
  } catch (e: any) {
    return jsonWithCors(req, { ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}
