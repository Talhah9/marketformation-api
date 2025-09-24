// app/api/profile/password/route.ts
import { handleOptions, jsonWithCors } from "@/app/api/_lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SHOPIFY_MODE = (process.env.SHOPIFY_MODE || "lite").toLowerCase();
const SHOP_DOMAIN  = process.env.SHOP_DOMAIN;
const ADMIN_TOKEN  =
  process.env.SHOP_ADMIN_TOKEN ||
  process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN ||
  process.env.ADMIN_TOKEN ||
  "";
const API_VERSION  = process.env.SHOPIFY_API_VERSION || "2024-07";

export async function OPTIONS(req: Request) {
  return handleOptions(req);
}

function adminEnvOK() {
  return !!(SHOP_DOMAIN && ADMIN_TOKEN);
}

async function adminGraphQL<T = any>(query: string, variables?: Record<string, any>): Promise<T> {
  const url = `https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/graphql.json`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": ADMIN_TOKEN,
      "Accept": "application/json",
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });

  // essaye de parser même en cas d’erreur HTTP pour remonter les messages
  const text = await r.text();
  let json: any = {};
  try { json = text ? JSON.parse(text) : {}; } catch {}

  if (!r.ok || json?.errors) {
    const msg =
      json?.errors?.[0]?.message ||
      `Shopify GraphQL error (${r.status})`;
    throw new Error(msg);
  }
  return json.data;
}

function toGID(id: string | number) {
  const s = String(id);
  return s.startsWith("gid://") ? s : `gid://shopify/Customer/${s}`;
}

async function findCustomerId({ idRaw, email }: { idRaw?: string; email?: string }) {
  if (idRaw) return toGID(idRaw);
  if (!email) return null;

  const qEmail = email.replace(/"/g, '\\"');
  const data = await adminGraphQL<{ customers: { edges: { node: { id: string } }[] } }>(
    `query Find($q:String!){
       customers(first: 1, query: $q) {
         edges { node { id } }
       }
     }`,
    { q: `email:"${qEmail}"` }
  );

  return data.customers?.edges?.[0]?.node?.id || null;
}

export async function POST(req: Request) {
  try {
    // parse robuste
    let body: any = {};
    try { body = await req.json(); } catch {}

    if (SHOPIFY_MODE !== "admin") {
      return jsonWithCors(req, { ok: false, error: "Password email disabled in lite mode." }, { status: 400 });
    }
    if (!adminEnvOK()) {
      return jsonWithCors(req, { ok: false, error: "Missing SHOP_DOMAIN or Admin token (SHOP_ADMIN_TOKEN / SHOPIFY_ADMIN_API_ACCESS_TOKEN / ADMIN_TOKEN)" }, { status: 400 });
    }

    const customerId = await findCustomerId({ idRaw: body.shopifyCustomerId, email: body.email });
    if (!customerId) {
      return jsonWithCors(req, { ok: false, error: "Customer not found." }, { status: 404 });
    }

    const data = await adminGraphQL<{
      customerSendAccountInviteEmail: { userErrors: { message: string }[] }
    }>(
      `mutation SendInvite($customerId: ID!) {
         customerSendAccountInviteEmail(customerId: $customerId) {
           userErrors { message }
         }
       }`,
      { customerId }
    );

    const errs = data.customerSendAccountInviteEmail?.userErrors || [];
    if (errs.length) {
      const msg =
        errs.map(e => e.message).join("; ") ||
        "Invite failed. Ensure classic customer accounts are enabled.";
      return jsonWithCors(req, { ok: false, error: msg }, { status: 400 });
    }

    return jsonWithCors(req, { ok: true, message: "Email envoyé." });
  } catch (e: any) {
    return jsonWithCors(req, { ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}
