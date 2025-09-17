// app/api/profile/password/route.ts
import { NextResponse } from "next/server";

const SHOP_DOMAIN = process.env.SHOP_DOMAIN;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-10";
const ORIGIN = process.env.CORS_ORIGIN || "https://tqiccz-96.myshopify.com";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin",
};
function withCorsJSON(data: any, init: ResponseInit = {}) {
  return new NextResponse(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...corsHeaders, ...(init.headers as any) },
  });
}
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

function assertEnv() {
  if (!SHOP_DOMAIN || !ADMIN_TOKEN)
    throw new Error("Missing SHOP_DOMAIN or ADMIN_TOKEN");
}

async function adminGraphQL<T = any>(query: string, variables?: Record<string, any>): Promise<T> {
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
    throw new Error(j?.errors?.[0]?.message || `Shopify GraphQL error (${r.status})`);
  }
  return j.data;
}

function toGID(id: string | number) {
  const s = String(id);
  return s.startsWith("gid://") ? s : `gid://shopify/Customer/${s}`;
}

async function findCustomerId({ idRaw, email }: { idRaw?: string; email?: string }): Promise<string | null> {
  if (idRaw) return toGID(idRaw);
  if (!email) return null;
  const q = `email:"${email.replace(/"/g, '\\"')}"`;
  const data = await adminGraphQL<{ customers: { edges: { node: { id: string } }[] } }>(
    `
    query FindCustomer($q: String!) {
      customers(first: 1, query: $q) { edges { node { id } } }
    }`,
    { q }
  );
  return data.customers.edges?.[0]?.node?.id || null;
}

/** POST: { shopifyCustomerId?: string, email?: string }
 *  envoie l'e-mail d'invitation (définition du mot de passe) pour comptes classiques.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const customerId = await findCustomerId({
      idRaw: body.shopifyCustomerId,
      email: body.email,
    });

    if (!customerId) {
      return withCorsJSON({ ok: false, error: "Customer not found." }, { status: 404 });
    }

    // Admin GraphQL 2024-10: send invite email
    const data = await adminGraphQL<{
      customerSendAccountInviteEmail: { userErrors: { message: string }[] } | null;
    }>(
      `
      mutation SendInvite($customerId: ID!) {
        customerSendAccountInviteEmail(customerId: $customerId) {
          userErrors { message }
        }
      }`,
      { customerId }
    );

    const errs = data.customerSendAccountInviteEmail?.userErrors || [];
    if (errs.length) {
      // Message utile si la boutique n'utilise pas les "comptes classiques"
      const msg =
        errs.map((e) => e.message).join("; ") ||
        "Invite failed. Ensure classic customer accounts are enabled.";
      return withCorsJSON({ ok: false, error: msg }, { status: 400 });
    }

    return withCorsJSON({ ok: true, message: "Email envoyé." });
  } catch (e: any) {
    return withCorsJSON({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}
