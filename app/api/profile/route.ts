// app/api/profile/route.ts
import { NextRequest, NextResponse } from "next/server";

const SHOP_DOMAIN = process.env.SHOP_DOMAIN || "";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const API_VERSION = "2025-07";

function requireEnv() {
  if (!SHOP_DOMAIN || !ADMIN_TOKEN) {
    throw new Error("Server misconfigured: missing SHOP_DOMAIN or ADMIN_TOKEN");
  }
}

async function shopify(path: string, init?: RequestInit) {
  requireEnv();
  const res = await fetch(`https://${SHOP_DOMAIN}/admin/api/${API_VERSION}${path}`, {
    ...init,
    headers: {
      "X-Shopify-Access-Token": ADMIN_TOKEN,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify ${init?.method || "GET"} ${path} -> ${res.status}: ${text}`);
  }
  return res.json();
}

async function resolveCustomer({ id, email }: { id?: string | number | null; email?: string | null; }) {
  if (id) {
    const data = await shopify(`/customers/${id}.json`);
    return data.customer;
  }
  if (email) {
    const q = encodeURIComponent(`email:${email}`);
    const data = await shopify(`/customers/search.json?query=${q}`);
    if (!data.customers?.length) throw new Error("Customer not found for email");
    return data.customers[0];
  }
  throw new Error("Provide shopifyCustomerId or email");
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("shopifyCustomerId");
    const email = searchParams.get("email");

    const customer = await resolveCustomer({ id, email });
    const m = await shopify(`/customers/${customer.id}/metafields.json?namespace=mf`);
    const list: any[] = m.metafields || [];
    const byKey = Object.fromEntries(list.map((x) => [x.key, x]));

    return NextResponse.json({
      ok: true,
      customerId: customer.id,
      profile: {
        bio: byKey["bio"]?.value || "",
        avatar_url: byKey["avatar_url"]?.value || "",
        expertise_url: byKey["expertise_url"]?.value || "",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { shopifyCustomerId, email, bio, avatar_url, expertise_url } = body;

    const customer = await resolveCustomer({ id: shopifyCustomerId, email });
    const current = await shopify(`/customers/${customer.id}/metafields.json?namespace=mf`);
    const existing = new Map<string, any>((current.metafields || []).map((m: any) => [m.key, m]));

    async function upsert(key: "bio" | "avatar_url" | "expertise_url", value: any, type: string) {
      if (typeof value === "undefined") return null; // skip
      if (existing.has(key)) {
        const m = existing.get(key);
        const res = await shopify(`/metafields/${m.id}.json`, {
          method: "PUT",
          body: JSON.stringify({ metafield: { id: m.id, value } }),
        });
        return res.metafield;
      } else {
        const res = await shopify(`/customers/${customer.id}/metafields.json`, {
          method: "POST",
          body: JSON.stringify({
            metafield: { namespace: "mf", key, type, value },
          }),
        });
        return res.metafield;
      }
    }

    const out: Record<string, string> = {};
    const ops = [
      ["bio", bio, "multi_line_text_field"],
      ["avatar_url", avatar_url, "url"],
      ["expertise_url", expertise_url, "url"],
    ] as const;

    for (const [k, v, t] of ops) {
      const r = await upsert(k, v, t);
      if (r) out[k] = r.value;
    }

    return NextResponse.json({
      ok: true,
      customerId: customer.id,
      profile: {
        bio: (out.bio ?? existing.get("bio")?.value) || "",
        avatar_url: (out.avatar_url ?? existing.get("avatar_url")?.value) || "",
        expertise_url: (out.expertise_url ?? existing.get("expertise_url")?.value) || "",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
  }
}

// (facultatif) CORS préflight minimum si besoin
export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
