// app/api/profile/route.ts
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* ============================================================
   CORS de base (identique à avant)
============================================================ */
const DEFAULT_SHOP_ORIGIN =
  process.env.SHOP_DOMAIN ? `https://${process.env.SHOP_DOMAIN}` : 'https://tqiccz-96.myshopify.com';

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
   Types + fallback mémoire (en dernier recours)
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

const g = globalThis as any;
if (!g.__MF_PROFILES) {
  g.__MF_PROFILES = {};
}
const MEMORY: Record<string, Profile> = g.__MF_PROFILES;

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
  try { json = text ? JSON.parse(text) : {}; } catch {}

  return { ok: res.ok, status: res.status, json, text };
}

// Résolution du customerId à partir d'un id ou d'un email
async function resolveCustomerId(email: string, shopifyCustomerId?: string): Promise<number | null> {
  if (shopifyCustomerId) {
    const num = Number(shopifyCustomerId);
    if (!Number.isNaN(num)) return num;
  }
  const trimmedEmail = (email || '').trim();
  if (!trimmedEmail) return null;

  const r = await shopifyFetch(`/customers/search.json?query=${encodeURIComponent(`email:${trimmedEmail}`)}&limit=1`);
  if (!r.ok) return null;
  const customers = r.json?.customers || [];
  if (!customers[0]?.id) return null;
  return Number(customers[0].id);
}

// Lecture des métachamps du customer → Profile
async function getProfileFromCustomer(customerId: number, fallbackEmail: string): Promise<Profile> {
  const r = await shopifyFetch(`/customers/${customerId}/metafields.json?limit=250`);
  const arr = (r.ok && r.json?.metafields) ? r.json.metafields : [];

  const getVal = (key: string) => {
    const mf = arr.find((m: any) => m?.namespace === 'mfapp_profile' && m?.key === key);
    return (mf?.value ?? '').toString();
  };

  return {
    bio: getVal('bio'),
    avatar_url: getVal('avatar_url'),
    expertise_url: getVal('expertise_url'),
    email: getVal('email') || fallbackEmail,
    shopifyCustomerId: String(customerId),
    first_name: getVal('first_name'),
    last_name: getVal('last_name'),
    phone: getVal('phone'),
    linkedin: getVal('linkedin'),
    twitter: getVal('twitter'),
    website: getVal('website'),
  };
}

// Upsert d'un métachamp sur customer
async function upsertCustomerMetafield(
  customerId: number,
  key: string,
  type: string,
  value: string,
) {
  return shopifyFetch(`/metafields.json`, {
    json: {
      metafield: {
        namespace: 'mfapp_profile',
        key,
        type,
        value,
        owner_resource: 'customer',
        owner_id: customerId,
      },
    },
  });
}

// Sauvegarde d'un Profile dans les métachamps du customer
async function saveProfileToCustomer(customerId: number, profile: Profile) {
  const entries: Array<[keyof Profile, string, string]> = [
    ['email', 'single_line_text_field', profile.email || ''],
    ['bio', 'multi_line_text_field', profile.bio || ''],
    ['avatar_url', 'url', profile.avatar_url || ''],
    ['expertise_url', 'url', profile.expertise_url || ''],
    ['first_name', 'single_line_text_field', profile.first_name || ''],
    ['last_name', 'single_line_text_field', profile.last_name || ''],
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
   GET profil public / privé
============================================================ */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const shopifyCustomerId = (url.searchParams.get('shopifyCustomerId') || '').toString();
    const email = (url.searchParams.get('email') || '').toString().trim();

    if (!email && !shopifyCustomerId) {
      return json(req, { ok: false, error: 'email_or_customerId_required' }, 400);
    }

    let profile: Profile | null = null;

    // 1) Tentative Shopify (persistance)
    try {
      const cid = await resolveCustomerId(email, shopifyCustomerId);
      if (cid) {
        profile = await getProfileFromCustomer(cid, email);
      }
    } catch (e) {
      console.warn('[MF-profile] Shopify profile fetch failed, fallback memory', e);
    }

    // 2) Fallback mémoire (en cas d’erreur ou si pas de customer)
    if (!profile) {
      const key = shopifyCustomerId || email || 'anonymous';
      const stored = MEMORY[key] || MEMORY[email] || null;
      if (stored) {
        profile = stored;
      }
    }

    // 3) Profil par défaut si rien trouvé
    if (!profile) {
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
   POST profil (sauvegarde)
============================================================ */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));

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
      linkedin: (body.linkedin || (body.socials && body.socials.linkedin) || '').toString(),
      twitter: (body.twitter || body.x || (body.socials && (body.socials.twitter || body.socials.x)) || '').toString(),
      website: (body.website || body.site || body.website_url || (body.socials && body.socials.website) || '').toString(),
    };

    // 1) Persistance Shopify (customer metafields)
    try {
      const cid = await resolveCustomerId(email, shopifyCustomerIdRaw);
      if (cid) {
        await saveProfileToCustomer(cid, profile);
        profile.shopifyCustomerId = String(cid);
      }
    } catch (e) {
      console.warn('[MF-profile] Shopify profile save failed, keep memory only', e);
    }

    // 2) On garde aussi en mémoire en fallback
    const memKey = profile.shopifyCustomerId || email || 'anonymous';
    MEMORY[memKey] = profile;
    if (email) MEMORY[email] = profile;

    return json(req, { ok: true, profile }, 200);
  } catch (e: any) {
    return json(req, { ok: false, error: e?.message || 'Profile POST failed' }, 500);
  }
}
