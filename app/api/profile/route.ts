// app/api/profile/route.ts
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* ============================================================
   CORS
============================================================ */
const DEFAULT_SHOP_ORIGIN =
  process.env.SHOP_DOMAIN
    ? `https://${process.env.SHOP_DOMAIN}`
    : 'https://tqiccz-96.myshopify.com';

const ALLOW_ORIGINS: string[] =
  (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

if (!ALLOW_ORIGINS.length && DEFAULT_SHOP_ORIGIN) {
  ALLOW_ORIGINS.push(DEFAULT_SHOP_ORIGIN);
}

const ALLOW_METHODS = 'GET, POST, OPTIONS';
const ALLOW_HEADERS = 'Content-Type, Authorization, X-Requested-With';

function pickOrigin(req: Request) {
  const o = (req.headers.get('origin') || '').trim();
  return o && ALLOW_ORIGINS.includes(o) ? o : ALLOW_ORIGINS[0] || '';
}

function withCORS(req: Request, res: NextResponse) {
  const origin = pickOrigin(req);
  if (origin) {
    res.headers.set('Access-Control-Allow-Origin', origin);
    res.headers.set('Access-Control-Allow-Methods', ALLOW_METHODS);
    res.headers.set('Access-Control-Allow-Headers', ALLOW_HEADERS);
    res.headers.set('Vary', 'Origin');
  }
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

function json(req: Request, data: any, status = 200) {
  return withCORS(
    req,
    new NextResponse(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

export async function OPTIONS(req: Request) {
  return withCORS(
    req,
    new NextResponse(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Methods': ALLOW_METHODS,
        'Access-Control-Allow-Headers': ALLOW_HEADERS,
      },
    }),
  );
}

/* ============================================================
   Types
============================================================ */
type Profile = {
  bio: string;
  avatar_url: string;
  expertise_url: string;
  email: string;
  shopifyCustomerId: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  linkedin?: string;
  twitter?: string;
  website?: string;
};

/* ============================================================
   Shopify helpers
============================================================ */
function getAdminToken() {
  return (
    process.env.SHOP_ADMIN_TOKEN ||
    process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN ||
    process.env.ADMIN_TOKEN ||
    ''
  );
}

async function shopifyFetch(path: string, init?: RequestInit & { json?: any }) {
  const domain = process.env.SHOP_DOMAIN;
  const token = getAdminToken();
  if (!domain || !token) {
    throw new Error('Missing SHOP_DOMAIN or Admin token');
  }

  const base = `https://${domain}/admin/api/2024-07`;
  const headers: Record<string, string> = {
    'X-Shopify-Access-Token': token,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  const res = await fetch(base + path, {
    method: init?.method || (init?.json ? 'POST' : 'GET'),
    headers,
    body: init?.json ? JSON.stringify(init.json) : undefined,
    cache: 'no-store',
  });

  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {}

  return { ok: res.ok, status: res.status, json, text };
}

async function resolveCustomerId(email: string, shopifyCustomerId?: string): Promise<number | null> {
  if (shopifyCustomerId) {
    const num = Number(shopifyCustomerId);
    if (!Number.isNaN(num)) return num;
  }

  const trimmedEmail = (email || '').trim();
  if (!trimmedEmail) return null;

  const r = await shopifyFetch(
    `/customers/search.json?query=${encodeURIComponent(`email:${trimmedEmail}`)}&limit=1`,
  );
  if (!r.ok) return null;

  const customers = (r.json as any)?.customers || [];
  if (!customers[0]?.id) return null;
  return Number(customers[0].id);
}

async function getProfileFromCustomer(customerId: number, fallbackEmail: string): Promise<Profile> {
  // 1) Customer de base (prénom / nom / email)
  const cRes = await shopifyFetch(`/customers/${customerId}.json`);
  const customer = (cRes.ok && (cRes.json as any)?.customer) || {};

  // 2) Métachamps namespace "mkt"
  const mRes = await shopifyFetch(`/customers/${customerId}/metafields.json?limit=250`);
  const arr = (mRes.ok && (mRes.json as any)?.metafields)
    ? (mRes.json as any).metafields
    : [];

  const getVal = (key: string) => {
    const mf = arr.find((m: any) => m?.namespace === 'mkt' && m?.key === key);
    return (mf?.value ?? '').toString();
  };

  const first_name = customer.first_name || '';
  const last_name  = customer.last_name || '';
  const email      = customer.email || fallbackEmail;

  return {
    bio: getVal('bio'),
    avatar_url: getVal('avatar_url'),
    expertise_url: getVal('expertise_url'),
    email,
    shopifyCustomerId: String(customerId),
    first_name,
    last_name,
    phone: getVal('phone'),
    linkedin: getVal('linkedin'),
    twitter: getVal('twitter'),
    website: getVal('website'),
  };
}

async function upsertCustomerMetafield(
  customerId: number,
  key: string,
  type: string,
  value: string,
) {
  return shopifyFetch(`/metafields.json`, {
    json: {
      metafield: {
        namespace: 'mkt',
        key,
        type,
        value,
        owner_resource: 'customer',
        owner_id: customerId,
      },
    },
  });
}

async function saveProfileToCustomer(customerId: number, profile: Profile) {
  const displayName = `${profile.first_name || ''} ${profile.last_name || ''}`.trim();

  const entries: Array<[string, string, string]> = [
    ['display_name', 'single_line_text_field', displayName],
    ['bio', 'multi_line_text_field', profile.bio || ''],
    ['avatar_url', 'url', profile.avatar_url || ''],
    ['expertise_url', 'url', profile.expertise_url || ''],
    ['phone', 'single_line_text_field', profile.phone || ''],
    ['linkedin', 'url', profile.linkedin || ''],
    ['twitter', 'url', profile.twitter || ''],
    ['website', 'url', profile.website || ''],
  ];

  for (const [key, type, value] of entries) {
    await upsertCustomerMetafield(customerId, key, type, value);
  }
}

/* ============================================================
   GET profil public
============================================================ */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const shopifyCustomerId = (url.searchParams.get('shopifyCustomerId') || '').toString();
    const email = (url.searchParams.get('email') || '').toString().trim();

    if (!email && !shopifyCustomerId) {
      return json(req, { ok: false, error: 'email_or_customerId_required' }, 400);
    }

    let profile: Profile;

    const cid = await resolveCustomerId(email, shopifyCustomerId);
    if (cid) {
      profile = await getProfileFromCustomer(cid, email);
    } else {
      // Pas de customer trouvé → profil minimal
      profile = {
        bio: '',
        avatar_url: '',
        expertise_url: '',
        email,
        shopifyCustomerId,
        first_name: '',
        last_name: '',
        phone: '',
        linkedin: '',
        twitter: '',
        website: '',
      };
    }

    return json(req, { ok: true, profile }, 200);
  } catch (e: any) {
    return json(req, { ok: false, error: e?.message || 'Profile GET failed' }, 500);
  }
}

/* ============================================================
   POST profil (sauvegarde dans les métachamps mkt.*)
============================================================ */
export async function POST(req: Request) {
  try {
    const raw = await req.json().catch(() => ({} as any));
    const body: any =
      raw.profile && typeof raw.profile === 'object' ? raw.profile : raw;

    const email = (body.email || body.contact_email || '').toString().trim();
    const shopifyCustomerIdRaw = (body.shopifyCustomerId || body.customerId || '').toString().trim();

    if (!email && !shopifyCustomerIdRaw) {
      return json(req, { ok: false, error: 'email_or_customerId_required' }, 400);
    }

    const profile: Profile = {
      bio: (body.bio || body.description || body.about || '').toString(),
      avatar_url: (body.avatar_url || body.avatarUrl || body.image_url || body.imageUrl || '').toString(),
      expertise_url: (body.expertise_url || body.expertiseUrl || '').toString(),
      email,
      shopifyCustomerId: shopifyCustomerIdRaw,
      first_name: (body.first_name || body.firstName || '').toString(),
      last_name: (body.last_name || body.lastName || '').toString(),
      phone: (body.phone || body.phone_number || '').toString(),
      linkedin: (body.linkedin || '').toString(),
      twitter: (body.twitter || body.x || '').toString(),
      website: (body.website || body.site || body.website_url || '').toString(),
    };

    const cid = await resolveCustomerId(email, shopifyCustomerIdRaw);
    if (cid) {
      await saveProfileToCustomer(cid, profile);
      profile.shopifyCustomerId = String(cid);
    }

    return json(req, { ok: true, profile }, 200);
  } catch (e: any) {
    return json(req, { ok: false, error: e?.message || 'Profile POST failed' }, 500);
  }
}
