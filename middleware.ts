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

function buildCorsHeaders(origin: string) {
  const headers = new Headers();
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Credentials', 'true');
  headers.set(
    'Access-Control-Allow-Headers',
    // 👇 **X-Trainer-Id ajouté ici**
    'Origin, Accept, Content-Type, Authorization, X-Requested-With, X-Trainer-Id'
  );
  headers.set(
    'Access-Control-Allow-Methods',
    'GET, POST, PUT, PATCH, DELETE, OPTIONS'
  );
  headers.set('Vary', 'Origin');
  return headers;
}

export function middleware(req: NextRequest) {
  const origin = getOrigin(req);
  const isPreflight =
    req.method === 'OPTIONS' &&
    req.headers.has('access-control-request-method');

  // Si pas d'origin autorisé → laisser passer sans CORS spécial
  if (!origin) {
    if (isPreflight) {
      // préflight d’un domaine non autorisé → on bloque “proprement”
      return new NextResponse(null, { status: 403 });
    }
    return NextResponse.next();
  }

  const corsHeaders = buildCorsHeaders(origin);

  // ✅ Réponse PRE-FLIGHT
  if (isPreflight) {
    return new NextResponse(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  // ✅ Requête normale : on laisse passer et on ajoute les headers CORS
  const res = NextResponse.next();
  corsHeaders.forEach((value, key) => {
    res.headers.set(key, value);
  });
  return res;
}
