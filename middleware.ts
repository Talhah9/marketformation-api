// middleware.ts
import { NextResponse, NextRequest } from 'next/server';

export const config = {
  matcher: ['/api/:path*'],
};

const ALLOWED_ORIGINS = [
  'https://marketformation.fr',
  'https://tqiccz-96.myshopify.com',
];

function getOrigin(req: NextRequest): string | null {
  const origin = req.headers.get('origin');
  if (!origin) return null;
  if (!ALLOWED_ORIGINS.includes(origin)) return null;
  return origin;
}

export function middleware(req: NextRequest) {
  const origin = getOrigin(req);

  const isPreflight =
    req.method === 'OPTIONS' &&
    req.headers.has('access-control-request-method');

  // Domaine non autorisé
  if (!origin) {
    if (isPreflight) {
      return new NextResponse(null, { status: 403 });
    }
    return NextResponse.next();
  }

  // 🔑 On récupère dynamiquement les headers demandés par le navigateur
  const requestedHeaders =
    req.headers.get('access-control-request-headers') || '';

  const resHeaders = new Headers();
  resHeaders.set('Access-Control-Allow-Origin', origin);
  resHeaders.set('Access-Control-Allow-Credentials', 'true');
  resHeaders.set(
    'Access-Control-Allow-Methods',
    'GET,POST,PUT,PATCH,DELETE,OPTIONS'
  );

  // ✅ On autorise explicitement nos headers + ceux demandés
  const baseAllowed =
    'Origin, Accept, Content-Type, Authorization, X-Requested-With, X-Trainer-Id, X-Trainer-Email';

  const allowHeaders = requestedHeaders
    ? baseAllowed + ', ' + requestedHeaders
    : baseAllowed;

  resHeaders.set('Access-Control-Allow-Headers', allowHeaders);
  resHeaders.set('Vary', 'Origin');

  // 🔁 Réponse PRE-FLIGHT
  if (isPreflight) {
    return new NextResponse(null, {
      status: 204,
      headers: resHeaders,
    });
  }

  // 🔁 Requête normale
  const res = NextResponse.next();
  resHeaders.forEach((value, key) => {
    res.headers.set(key, value);
  });
  return res;
}
