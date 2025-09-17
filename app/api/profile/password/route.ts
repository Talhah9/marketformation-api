// app/api/profile/password/route.ts
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { shopifyCustomerId, email } = body;
    const customer = await resolveCustomer({ id: shopifyCustomerId, email });

    // Envoie une invitation (le client recevra un email pour définir / réinitialiser son mot de passe)
    const payload = {
      customer_invite: {
        to: customer.email,
        from: null,
        subject: null,
        custom_message: null
      }
    };
    await shopify(`/customers/${customer.id}/send_invite.json`, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    return NextResponse.json({ ok: true, sent: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
  }
}

export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Methods": "POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
