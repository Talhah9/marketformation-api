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

// 🔥 Liste des endpoints CORS autorisés
const CORS_PATHS: RegExp[] = [
  /^\/api\/upload\/image$/,
  /^\/api\/upload\/pdf$/,
  /^\/api\/upload\/pdf\/start$/,
  /^\/api\/courses$/,
  /^\/api\/profile$/,
  /^\/api\/profile\/password$/,
  /^\/api\/subscription$/,
  /^\/api\/stripe\/checkout$/,
  /^\/api\/stripe\/portal$/,
  /^\/api\/ping$/,
  /^\/api\/student\/courses$/,   // ✅ AJOUT ICI
];

export function middleware(req: NextRequest) {
  const origin = getOrigin(req);

  const { pathname } = req.nextUrl;

  // Si l’endpoint n’est pas dans CORS_PATHS → on laisse passer sans CORS
  const isCorsEndpoint = CORS_PATHS.some((r) => r.test(pathname));

  const isPreflight =
    req.method === 'OPTIONS' &&
    req.headers.has('access-control-request-method');

  if (!origin) {
    if (isPreflight) {
      return new NextResponse(null, { status: 403 });
    }
    return NextResponse.next();
  }

  if (!isCorsEndpoint) {
    return NextResponse.next();
  }

  const requestedHeaders =
    req.headers.get('access-control-request-headers') || '';

  const resHeaders = new Headers();
  resHeaders.set('Access-Control-Allow-Origin', origin);
  resHeaders.set('Access-Control-Allow-Credentials', 'true');
  resHeaders.set(
    'Access-Control-Allow-Methods',
    'GET,POST,PUT,PATCH,DELETE,OPTIONS'
  );

  // ⬇️ ON AJOUTE UNIQUEMENT LES 2 HEADERS ÉLÈVE
  const baseAllowed =
    'Origin, Accept, Content-Type, Authorization, X-Requested-With, ' +
    'X-Trainer-Id, X-Trainer-Email, X-Student-Id, X-Student-Email';

  const allowHeaders = requestedHeaders
    ? baseAllowed + ', ' + requestedHeaders
    : baseAllowed;

  resHeaders.set('Access-Control-Allow-Headers', allowHeaders);
  resHeaders.set('Vary', 'Origin');

  if (isPreflight) {
    return new NextResponse(null, {
      status: 204,
      headers: resHeaders,
    });
  }

  const res = NextResponse.next();
  resHeaders.forEach((value, key) => {
    res.headers.set(key, value);
  });
  return res;
}
