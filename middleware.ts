// middleware.ts
import { NextResponse, NextRequest } from 'next/server'

/**
 * CORS global pour toutes les routes /api/*
 * - Autorise l'origine qui appelle (Shopify, marketformation.fr, etc.)
 * - Gère correctement le préflight OPTIONS
 */

function buildCorsHeaders(origin: string) {
  const h = new Headers();

  h.set('Access-Control-Allow-Origin', origin);
  h.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  h.set(
    'Access-Control-Allow-Headers',
    'Origin, Accept, Content-Type, Authorization, X-Requested-With, X-Trainer-Id'
  );
  h.set('Access-Control-Allow-Credentials', 'true');
  h.set('Vary', 'Origin');

  return h;
}


export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Ne touche qu’aux routes API
  if (!pathname.startsWith('/api')) {
    return NextResponse.next()
  }

  const origin = req.headers.get('origin')
  const isPreflight =
    req.method === 'OPTIONS' &&
    req.headers.has('access-control-request-method')

  // 🔁 1) Préflight OPTIONS → on répond direct avec les bons headers
  if (isPreflight) {
    const headers = buildCorsHeaders(origin)
    return new NextResponse(null, {
      status: 204,
      headers,
    })
  }

  // 🔁 2) Requête normale → on laisse passer puis on ajoute les headers
  const res = NextResponse.next()
  const corsHeaders = buildCorsHeaders(origin)
  corsHeaders.forEach((value, key) => {
    res.headers.set(key, value)
  })

  return res
}

// Middleware actif sur toutes les routes /api/*
export const config = {
  matcher: ['/api/:path*'],
}
