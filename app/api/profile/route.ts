// app/api/profile/route.ts
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// --- CORS piloté par ENV ---
// - CORS_ORIGINS : liste d'origins séparés par des virgules
// - SHOP_DOMAIN  : fallback (ex: "tqiccz-96.myshopify.com") => origin = https://SHOP_DOMAIN
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
    // Si un jour tu passes par les cookies : activer aussi Allow-Credentials
    // res.headers.set('Access-Control-Allow-Credentials', 'true');
  }
  // On évite le cache sur les données profil
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

// Typage simple du profil renvoyé / attendu
type TrainerProfile = {
  email: string;
  shopifyCustomerId: string;
  first_name: string;
  last_name: string;
  bio: string;
  avatar_url: string;
  expertise_url: string;
  linkedin: string;
  twitter: string;
  instagram: string;
  website: string;
};

/**
 * GET /api/profile?email=...&shopifyCustomerId=...
 *
 * Pour l'instant on renvoie un profil "vide" (ou toutes valeurs qu'on arrive à retrouver)
 * À brancher ensuite sur ta BDD / metafields Shopify si tu veux de la vraie persistance.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const email = (url.searchParams.get('email') || '').toString();
    const shopifyCustomerId = (url.searchParams.get('shopifyCustomerId') || '').toString();

    // TODO : ici tu peux aller chercher les vraies données (Shopify metafields / DB)
    const profile: TrainerProfile = {
      email,
      shopifyCustomerId,
      first_name: '',
      last_name: '',
      bio: '',
      avatar_url: '',
      expertise_url: '',
      linkedin: '',
      twitter: '',
      instagram: '',
      website: '',
    };

    return json(req, { ok: true, profile }, 200);
  } catch (e: any) {
    console.error('[MF] /api/profile GET error', e);
    return json(req, { ok: false, error: e?.message || 'Profile GET failed' }, 500);
  }
}

/**
 * POST /api/profile
 *
 * Reçoit les infos envoyées depuis :
 * - l’onglet "Profil" du compte formateur
 * - plus tard éventuellement d’autres back-offices
 *
 * Pour l’instant : on se contente de renvoyer ce qu’on reçoit.
 * À brancher plus tard sur ta couche de persistance (Shopify metafields / DB).
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) || {};

    const profile: TrainerProfile = {
      email: (body.email || '').toString(),
      shopifyCustomerId: (body.shopifyCustomerId || '').toString(),
      first_name: (body.first_name || body.firstName || '').toString(),
      last_name: (body.last_name || body.lastName || '').toString(),
      bio: (body.bio || '').toString(),
      avatar_url: (body.avatar_url || body.avatarUrl || '').toString(),
      expertise_url: (body.expertise_url || body.expertiseUrl || '').toString(),
      linkedin: (body.linkedin || body.social_linkedin || '').toString(),
      twitter: (body.twitter || body.social_twitter || '').toString(),
      instagram: (body.instagram || body.social_instagram || '').toString(),
      website: (body.website || body.site || '').toString(),
    };

    // TODO : persister `profile` (Shopify metafields / base externe)
    // Ex. : await saveTrainerProfile(profile);

    return json(req, { ok: true, profile }, 200);
  } catch (e: any) {
    console.error('[MF] /api/profile POST error', e);
    return json(req, { ok: false, error: e?.message || 'Profile POST failed' }, 500);
  }
}
