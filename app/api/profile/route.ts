// app/api/profile/route.ts
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// --- CORS piloté par ENV ---
// - CORS_ORIGINS : liste d'origins séparés par des virgules (ex: "https://mf-api-gold-topaz.vercel.app,https://topaz-xxx.myshopify.com")
// - SHOP_DOMAIN  : fallback (ex: "topaz-xxx.myshopify.com") => origin = https://SHOP_DOMAIN
const DEFAULT_SHOP_ORIGIN =
  process.env.SHOP_DOMAIN ? `https://${process.env.SHOP_DOMAIN}` : 'https://tqiccz-96.myshopify.com';

const ALLOW_ORIGINS: string[] =
  (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

if (!ALLOW_ORIGINS.length && DEFAULT_SHOP_ORIGIN) {
  ALLOW_ORIGINS.push(DEFAULT_SHOP_ORIGIN);
}

const ALLOW_METHODS = 'GET, POST, OPTIONS';
const ALLOW_HEADERS = 'Content-Type, Authorization, X-Requested-With';

function pickOrigin(req: Request) {
  const o = (req.headers.get('origin') || '').trim();
  return o && ALLOW_ORIGINS.includes(o) ? o : (ALLOW_ORIGINS[0] || '');
}

function withCORS(req: Request, res: NextResponse) {
  const origin = pickOrigin(req);
  if (origin) {
    res.headers.set('Access-Control-Allow-Origin', origin);
    res.headers.set('Access-Control-Allow-Methods', ALLOW_METHODS);
    res.headers.set('Access-Control-Allow-Headers', ALLOW_HEADERS);
    // res.headers.set('Access-Control-Allow-Credentials', 'true'); // active uniquement si tu utilises des cookies (credentials:'include')
    res.headers.set('Vary', 'Origin');
  }
  // Pas de cache pour les données profil
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

function json(req: Request, data: any, status = 200) {
  return withCORS(
    req,
    new NextResponse(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
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
    })
  );
}

// ===== GET profil (adapter à ta persistance réelle)
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const shopifyCustomerId = url.searchParams.get('shopifyCustomerId') || '';
    const email = url.searchParams.get('email') || '';

    // TODO: récupérer le profil réel (BDD / Shopify metafields)
    const profile = {
      bio: '',
      avatar_url: '',
      expertise_url: '',
      email,
      shopifyCustomerId,
    };

    return json(req, { ok: true, profile }, 200);
  } catch (e: any) {
    return json(req, { ok: false, error: e?.message || 'Profile GET failed' }, 500);
  }
}

// ===== POST profil (sauvegarde)
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    // TODO: persister body.bio, body.avatar_url, body.expertise_url…
    const profile = {
      bio: (body.bio || '').toString(),
      avatar_url: (body.avatar_url || body.avatarUrl || '').toString(),
      expertise_url: (body.expertise_url || body.expertiseUrl || '').toString(),
      email: (body.email || '').toString(),
      shopifyCustomerId: (body.shopifyCustomerId || '').toString(),
    };

    return json(req, { ok: true, profile }, 200);
  } catch (e: any) {
    return json(req, { ok: false, error: e?.message || 'Profile POST failed' }, 500);
  }
}
