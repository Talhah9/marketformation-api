// app/api/profile/route.ts
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN_LIST || process.env.CORS_ORIGIN || 'https://tqiccz-96.myshopify.com')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

function pickOrigin(req: Request) {
  const o = req.headers.get('origin') || '';
  return ALLOWED_ORIGINS.includes(o) ? o : null;
}

function withCORS(req: Request, res: NextResponse) {
  const origin = pickOrigin(req);
  if (origin) {
    res.headers.set('Access-Control-Allow-Origin', origin);
    res.headers.set('Vary', 'Origin');
    // ⚠️ nécessaire quand credentials:'include'
    res.headers.set('Access-Control-Allow-Credentials', 'true');
    res.headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  }
  return res;
}

function json(req: Request, data: any, status = 200) {
  return withCORS(req, NextResponse.json(data, { status }));
}

export async function OPTIONS(req: Request) {
  return withCORS(
    req,
    new NextResponse(null, { status: 204 })
  );
}

// Exemple d’implémentation GET (adapte à ton stockage)
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const shopifyCustomerId = url.searchParams.get('shopifyCustomerId');
    const email = url.searchParams.get('email');

    // TODO: fetch profil en BDD/metafields selon tes clés
    const profile = {
      bio: '',
      avatar_url: '',
      expertise_url: '',
      shopifyCustomerId,
      email,
    };

    return json(req, { ok: true, profile }, 200);
  } catch (e: any) {
    return json(req, { ok: false, error: e?.message || 'Profile GET failed' }, 500);
  }
}

// Exemple POST (sauvegarde)
export async function POST(req: Request) {
  try {
    const body = await req.json();

    // TODO: persister body.bio, body.avatar_url, body.expertise_url …

    const profile = {
      bio: body.bio || '',
      avatar_url: body.avatar_url || body.avatarUrl || '',
      expertise_url: body.expertise_url || body.expertiseUrl || '',
      email: body.email,
      shopifyCustomerId: body.shopifyCustomerId,
    };

    return json(req, { ok: true, profile }, 200);
  } catch (e: any) {
    return json(req, { ok: false, error: e?.message || 'Profile POST failed' }, 500);
  }
}
