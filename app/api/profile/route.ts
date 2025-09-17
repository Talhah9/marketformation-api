// app/api/profile/route.ts
import { NextRequest, NextResponse } from "next/server";

const SHOP_DOMAIN = process.env.SHOP_DOMAIN;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const API_VERSION = "2025-07";

if (!SHOP_DOMAIN || !ADMIN_TOKEN) {
  throw new Error("Missing SHOP_DOMAIN or ADMIN_TOKEN env vars.");
}

async function shopify(path: string, init?: RequestInit) {
  const res = await fetch(
    `https://${SHOP_DOMAIN}/admin/api/${API_VERSION}${path}`,
    {
      ...init,
      headers: {
        "X-Shopify-Access-Token": ADMIN_TOKEN!,
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
      cache: "no-store",
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Shopify ${init?.method || "GET"} ${path} -> ${res.status}: ${text}`
    );
  }
  return res.json();
}

async function resolveCustomer({
  id,
  email,
}: {
  id?: string | number | null;
  email?: string | null;
}) {
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

    const metafieldsRes = await shopify(
      `/customers/${customer.id}/metafields.json?namespace=mf`
    );
    const list: any[] = metafieldsRes.metafields || [];
    const byKey = Object.fromEntries(list.map((m) => [m.key, m]));

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

    // Load existing metafields in namespace mf
    const mfListRes = await shopify(
      `/customers/${customer.id}/metafields.json?namespace=mf`
    );
    const existing = new Map<string, any>(
      (mfListRes.metafields || []).map((m: any) => [m.key, m])
    );

    async function upsert(
      key: "bio" | "avatar_url" | "expertise_url",
      value: any,
      createType: string
    ) {
      if (typeof value === "undefined") return null; // skip if not provided
      if (existing.has(key)) {
        const m = existing.get(key);
        const updated = await shopify(`/metafields/${m.id}.json`, {
          method: "PUT",
          body: JSON.stringify({ metafield: { id: m.id, value } }),
        });
        return updated.metafield;
      } else {
        const created = await shopify(
          `/customers/${customer.id}/metafields.json`,
          {
            method: "POST",
            body: JSON.stringify({
              metafield: {
                namespace: "mf",
                key,
                type: createType,
                value,
              },
            }),
          }
        );
        return created.metafield;
      }
    }

    const results: Record<string, any> = {};
    const tasks = [
      ["bio", bio, "multi_line_text_field"],
      ["avatar_url", avatar_url, "url"],
      ["expertise_url", expertise_url, "url"],
    ] as const;

    for (const [key, value, type] of tasks) {
      const r = await upsert(key, value, type);
      if (r) results[key] = r.value;
    }

    return NextResponse.json({
      ok: true,
      customerId: customer.id,
      profile: {
        bio: results.bio ?? existing.get("bio")?.value ?? "",
        avatar_url:
          results.avatar_url ?? existing.get("avatar_url")?.value ?? "",
        expertise_url:
          results.expertise_url ?? existing.get("expertise_url")?.value ?? "",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
  }
}
