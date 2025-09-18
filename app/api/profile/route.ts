// app/api/profile/route.ts
import { NextResponse } from "next/server";
import { handleOptions, jsonWithCors } from "@/app/api/_lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SHOPIFY_MODE = (process.env.SHOPIFY_MODE || "lite").toLowerCase(); // "admin" | "lite"
const SHOP_DOMAIN  = process.env.SHOP_DOMAIN;     // ex: tqiccz-96.myshopify.com
const ADMIN_TOKEN  = process.env.ADMIN_TOKEN;     // Admin API token
const API_VERSION  = process.env.SHOPIFY_API_VERSION || "2024-10";

export async function OPTIONS(req: Request) {
  return handleOptions(req);
}

/* ===== Helpers Shopify (admin mode) ===== */
function adminEnvOK() {
  return !!(SHOP_DOMAIN && ADMIN_TOKEN);
}

async function adminGraphQL<T = any>(query: string, variables?: Record<string, any>): Promise<T> {
  const url = `https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/graphql.json`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": ADMIN_TOKEN! },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  const j = await r.json().catch(() => ({} as any));
  if (!r.ok || j?.errors) {
    throw new Error(j?.errors?.[0]?.message || `Shopify GraphQL error (${r.status})`);
  }
  return j.data;
}

function toGID(id: string | number) {
  const s = String(id);
  return s.startsWith("gid://") ? s : `gid://shopify/Customer/${s}`;
}

const MF_NS = "mf";
function pickPublicMetas(nodes?: Array<{ key: string; value: string }>) {
  const map: Record<string,string> = {};
  for (const n of nodes || []) map[n.key] = n.value;
  return {
    bio: map.bio || "",
    avatar_url: map.avatar_url || "",
    expertise_url: map.expertise_url || "",
  };
}

async function findCustomer({ id, email }: { id?: string; email?: string }) {
  if (id) {
    const data = await adminGraphQL<{ customer: any }>(
      `query GetCustomer($id: ID!) {
        customer(id: $id) {
          id firstName lastName email phone
          metafields(first: 10, namespace: "${MF_NS}") {
            edges { node { key value } }
          }
        }
      }`, { id }
    );
    const c = data.customer;
    if (!c) return null;
    return {
      id: c.id, firstName: c.firstName, lastName: c.lastName, email: c.email, phone: c.phone,
      metas: c.metafields.edges.map((e: any) => e.node)
    };
  }
  if (email) {
    const q = `email:"${email.replace(/"/g,'\\"')}"`;
    const data = await adminGraphQL<{ customers: any }>(
      `query FindCustomer($q: String!) {
        customers(first: 1, query: $q) {
          edges { node {
            id firstName lastName email phone
            metafields(first: 10, namespace: "${MF_NS}") { edges { node { key value } } }
          } }
        }
      }`, { q }
    );
    const edge = data.customers.edges?.[0];
    if (!edge) return null;
    const c = edge.node;
    return {
      id: c.id, firstName: c.firstName, lastName: c.lastName, email: c.email, phone: c.phone,
      metas: c.metafields.edges.map((e: any) => e.node)
    };
  }
  return null;
}

/* ===== GET ===== */
export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const idRaw  = u.searchParams.get("shopifyCustomerId") || undefined;
    const email  = u.searchParams.get("email") || undefined;

    // LITE: renvoie vide mais OK (évite erreurs console)
    if (SHOPIFY_MODE !== "admin") {
      return jsonWithCors(req, {
        ok: true,
        mode: "lite",
        profile: { bio: "", avatar_url: "", expertise_url: "" },
        note: "SHOPIFY_MODE!=admin: lecture Shopify désactivée."
      });
    }

    if (!adminEnvOK()) {
      return jsonWithCors(req, { ok: false, error: "Missing SHOP_DOMAIN or ADMIN_TOKEN" }, { status: 400 });
    }
    if (!idRaw && !email) {
      return jsonWithCors(req, { ok: false, error: "Missing identifier." }, { status: 400 });
    }

    const id  = idRaw ? toGID(idRaw) : undefined;
    const c   = await findCustomer({ id, email });
    if (!c) return jsonWithCors(req, { ok: false, error: "Customer not found." }, { status: 404 });

    const profile = pickPublicMetas(c.metas);
    return jsonWithCors(req, {
      ok: true,
      mode: "admin",
      profile,
      customer: { id: c.id, firstName: c.firstName, lastName: c.lastName, email: c.email, phone: c.phone }
    });
  } catch (e: any) {
    return jsonWithCors(req, { ok: false, error: e?.message || "Server error" }, { status: 200 });
  }
}

/* ===== POST ===== */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const idRaw: string | undefined = body.shopifyCustomerId;
    const email: string | undefined = body.email;

    // LITE : pas d’écriture Shopify (renvoie écho pour UI)
    if (SHOPIFY_MODE !== "admin") {
      const profile = {
        bio: String(body.bio || ""),
        avatar_url: String(body.avatar_url || body.avatarUrl || ""),
        expertise_url: String(body.expertise_url || body.expertiseUrl || ""),
      };
      return jsonWithCors(req, { ok: true, mode: "lite", persisted: false, profile });
    }

    if (!adminEnvOK()) {
      return jsonWithCors(req, { ok: false, error: "Missing SHOP_DOMAIN or ADMIN_TOKEN" }, { status: 400 });
    }
    if (!idRaw && !email) {
      return jsonWithCors(req, { ok: false, error: "Missing identifier." }, { status: 400 });
    }

    const found = await findCustomer({ id: idRaw ? toGID(idRaw) : undefined, email });
    if (!found) return jsonWithCors(req, { ok: false, error: "Customer not found." }, { status: 404 });

    const customerId = found.id;

    // 1) Infos compte (optionnel)
    const updInput: Record<string, any> = { id: customerId };
    if (typeof body.firstName === "string") updInput.firstName = body.firstName;
    if (typeof body.lastName  === "string") updInput.lastName  = body.lastName;
    if (typeof body.emailNew  === "string" && body.emailNew) updInput.email = body.emailNew;
    if (typeof body.phone     === "string") updInput.phone = body.phone;

    if (Object.keys(updInput).length > 1) {
      const data = await adminGraphQL<{ customerUpdate: any }>(
        `mutation UpdateCustomer($input: CustomerInput!) {
          customerUpdate(input: $input) { customer { id } userErrors { message } }
        }`, { input: updInput }
      );
      const errs = data.customerUpdate?.userErrors || [];
      if (errs.length) {
        return jsonWithCors(req, { ok: false, error: errs.map((e: any)=> e.message).join("; ") }, { status: 400 });
      }
    }

    // 2) Métas publics
    const metas: any[] = [];
    if (typeof body.bio === "string")
      metas.push({ ownerId: customerId, namespace: MF_NS, key: "bio", type: "multi_line_text_field", value: body.bio });
    const avatar = body.avatar_url || body.avatarUrl;
    const expert = body.expertise_url || body.expertiseUrl;
    if (typeof avatar === "string" && avatar)
      metas.push({ ownerId: customerId, namespace: MF_NS, key: "avatar_url", type: "url", value: avatar });
    if (typeof expert === "string" && expert)
      metas.push({ ownerId: customerId, namespace: MF_NS, key: "expertise_url", type: "url", value: expert });

    if (metas.length) {
      const data = await adminGraphQL<{ metafieldsSet: any }>(
        `mutation SetMetas($metas: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metas) { metafields { key } userErrors { message } }
        }`, { metas }
      );
      const errs = data.metafieldsSet?.userErrors || [];
      if (errs.length) {
        return jsonWithCors(req, { ok: false, error: errs.map((e: any)=> e.message).join("; ") }, { status: 400 });
      }
    }

    // 3) Retour état
    const c = await findCustomer({ id: customerId });
    const profile = pickPublicMetas(c?.metas);
    return jsonWithCors(req, {
      ok: true, mode: "admin",
      profile,
      customer: { id: c?.id, firstName: c?.firstName, lastName: c?.lastName, email: c?.email, phone: c?.phone }
    });
  } catch (e: any) {
    return jsonWithCors(req, { ok: false, error: e?.message || "Server error" }, { status: 200 });
  }
}
