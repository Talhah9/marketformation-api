// app/api/profile/route.ts
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* ============================================================
   CORS
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
   Types + mémoire
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

function makeKey(email: string, shopifyCustomerId: string) {
  return shopifyCustomerId || email || 'anonymous';
}

function getFirst(obj: any, keys: string[]): string {
  if (!obj) return '';
  for (const k of keys) {
    if (obj[k] != null && obj[k] !== '') {
      return String(obj[k]);
    }
  }
  return '';
}

/* ============================================================
   GET profil public / privé
============================================================ */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const shopifyCustomerId = (url.searchParams.get('shopifyCustomerId') || '').toString();
    const email = (url.searchParams.get('email') || '').toString().trim();

    const key = makeKey(email, shopifyCustomerId);

    // 1) lookup direct par clé
    let stored: Profile | undefined = MEMORY[key];

    // 2) fallback clé email
    if (!stored && email) {
      stored = MEMORY[email];
    }

    // 3) dernier recours : on scanne tous les profils par email
    if (!stored && email) {
      const all = Object.values(MEMORY) as Profile[];
      stored = all.find((p) => (p.email || '').trim() === email) as Profile | undefined;
    }

    const profile: Profile =
      stored || {
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
    const rawBody = await req.json().catch(() => ({} as any));

    // le payload peut être { ... } ou { profile: {...} }
    const body: any = rawBody.profile && typeof rawBody.profile === 'object'
      ? rawBody.profile
      : rawBody;

    const email = getFirst(body, ['email', 'contact_email', 'customer_email']);
    const shopifyCustomerId = getFirst(body, ['shopifyCustomerId', 'customerId', 'id']);

    const key = makeKey(email, shopifyCustomerId);

    const rawBio = getFirst(body, ['bio', 'description', 'about', 'mkt.bio']);

    const profile: Profile = {
      bio: rawBio || '',
      avatar_url: getFirst(body, ['avatar_url', 'avatarUrl', 'image_url', 'imageUrl']),
      expertise_url: getFirst(body, ['expertise_url', 'expertiseUrl']),
      email,
      shopifyCustomerId,
      first_name: getFirst(body, ['first_name', 'firstName']),
      last_name: getFirst(body, ['last_name', 'lastName']),
      phone: getFirst(body, ['phone', 'phone_number']),
      linkedin: getFirst(body, ['linkedin']),
      twitter: getFirst(body, ['twitter', 'x']),
      website: getFirst(body, ['website', 'site', 'website_url']),
    };

    // on ne laisse pas un email totalement vide si on peut l'avoir ailleurs
    if (!profile.email && rawBody.email) {
      profile.email = String(rawBody.email);
    }

    // stockage principal
    MEMORY[key] = profile;

    // stockage par email
    if (profile.email) {
      MEMORY[profile.email] = profile;
    }

    return json(req, { ok: true, profile }, 200);
  } catch (e: any) {
    return json(req, { ok: false, error: e?.message || 'Profile POST failed' }, 500);
  }
}
