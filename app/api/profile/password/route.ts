// app/api/profile/password/route.ts
import { handleOptions, jsonWithCors } from "@/app/api/_lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ENV (compat) */
const STORE =
  process.env.SHOPIFY_STORE_DOMAIN ||
  process.env.SHOP_DOMAIN ||
  "";
const TOKEN =
  process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN ||
  process.env.ADMIN_TOKEN ||
  "";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-10";

function assertEnv() {
  if (!STORE || !TOKEN) {
    throw new Error("Missing SHOPIFY_STORE_DOMAIN/SHOP_DOMAIN or SHOPIFY_ADMIN_API_ACCESS_TOKEN/ADMIN_TOKEN");
  }
}

async function adminGraphQL<T = any>(query: string, variables?: Record<string, any>): Promise<T> {
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

/** ---------- CORS preflight ---------- */
export async function OPTIONS(req: Request) {
  return handleOptions(req);
}

/** ---------- POST /api/profile/password ----------
 * Body: { shopifyCustomerId?: string, email?: string }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const customerId = await findCustomerId({
      idRaw: body.shopifyCustomerId,
      email: body.email,
    });

    if (!customerId) {
      return jsonWithCors(req, { ok: false, error: "Customer not found." }, { status: 404 });
    }

    // Envoi de l'email d'invitation (comptes classiques)
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
