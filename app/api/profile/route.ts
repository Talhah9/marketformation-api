// app/api/profile/route.ts
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// -------- CORS partagé --------
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

// --------- Pseudo-persistence en mémoire (par instance Vercel) ----------
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

// ===== GET profil public / privé =====
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const shopifyCustomerId = (url.searchParams.get('shopifyCustomerId') || '').toString();
    const email = (url.searchParams.get('email') || '').toString();

    const key = makeKey(email, shopifyCustomerId);

    // 🔧 on essaie d'abord la clé "normale", puis la clé email seule
    let stored = MEMORY[key];
    if (!stored && email) {
      stored = MEMORY[email];
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

// ===== POST profil (sauvegarde) =====
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const email = (body.email || '').toString();
    const shopifyCustomerId = (body.shopifyCustomerId || '').toString();

    const key = makeKey(email, shopifyCustomerId);

    const profile: Profile = {
      bio: (body.bio || '').toString(),
      avatar_url: (body.avatar_url || body.avatarUrl || '').toString(),
      expertise_url: (body.expertise_url || body.expertiseUrl || '').toString(),
      email,
      shopifyCustomerId,
      first_name: (body.first_name || '').toString(),
      last_name: (body.last_name || '').toString(),
      phone: (body.phone || '').toString(),
      linkedin: (body.linkedin || '').toString(),
      twitter: (body.twitter || '').toString(),
      website: (body.website || '').toString(),
    };

    // PERSISTE EN MÉMOIRE (par instance)
    MEMORY[key] = profile;

    // 🔧 aussi sous la clé email pour /api/profile?email=...
    if (email) {
      MEMORY[email] = profile;
    }

    return json(req, { ok: true, profile }, 200);
  } catch (e: any) {
    return json(req, { ok: false, error: e?.message || 'Profile POST failed' }, 500);
  }
}
