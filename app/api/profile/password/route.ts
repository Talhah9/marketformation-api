import { jsonWithCors, handleOptions } from "@/app/api/_lib/cors";

const SHOP_DOMAIN =
  process.env.SHOP_DOMAIN || process.env.SHOPIFY_STORE_DOMAIN;
const ADMIN_TOKEN =
  process.env.ADMIN_TOKEN || process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN;
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-10";

export async function OPTIONS(req: Request) {
  return handleOptions(req);
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

/** POST: { shopifyCustomerId?: string }
 *  Envoie l'e-mail d'invitation (comptes classiques).
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const idRaw: string | undefined = body.shopifyCustomerId;

    if (!idRaw) {
      return jsonWithCors(req, { ok: false, error: "Missing shopifyCustomerId." }, { status: 400 });
    }

    const customerId = toGID(idRaw);

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
        errs.map((e) => e.message).join("; ") ||
        "Invite failed. Ensure classic customer accounts are enabled.";
      return jsonWithCors(req, { ok: false, error: msg }, { status: 400 });
    }

    return jsonWithCors(req, { ok: true, message: "Email envoyé." });
  } catch (e: any) {
    return jsonWithCors(req, { ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}
