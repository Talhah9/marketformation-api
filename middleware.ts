// middleware.ts
import { NextResponse, NextRequest } from 'next/server'

/**
 * ORIGINES AUTORISÉES
 * - Priorité à l'env CORS_ORIGINS (séparées par des virgules)
 * - Sinon, fallback sur le domaine Shopify de ta boutique
 */
const ENV_ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

const DEFAULT_ORIGINS = ['https://tqiccz-96.myshopify.com']
const ALLOWED_ORIGINS = new Set([...(ENV_ORIGINS.length ? ENV_ORIGINS : DEFAULT_ORIGINS)])

/**
 * Routes qui nécessitent CORS (tu peux en ajouter/en retirer au besoin)
 * - Uploads (image/pdf + direct-to-blob /start)
 * - Profile (GET/POST), Password
 * - Courses (création/liste), Subscription, Stripe (checkout/portal)
 */
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
]

function needsCors(pathname: string): boolean {
  return CORS_PATHS.some(rx => rx.test(pathname))
}

function isAllowedOrigin(origin: string | null): origin is string {
  if (!origin) return false
  return ALLOWED_ORIGINS.has(origin)
}

function buildCorsHeaders(origin: string) {
  const h = new Headers()
  h.set('Access-Control-Allow-Origin', origin)
  h.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
  h.set('Access-Control-Allow-Headers', 'Origin, Accept, Content-Type, Authorization')
  // Si tu dois envoyer des cookies cross-site, ajoute:
  // h.set('Access-Control-Allow-Credentials', 'true')
  h.set('Vary', 'Origin')
  return h
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  // On ne s’occupe que de /api/*
  if (!pathname.startsWith('/api')) return NextResponse.next()

  const origin = req.headers.get('origin')
  const isPreflight =
    req.method === 'OPTIONS' && req.headers.has('access-control-request-method')

  const shouldCors = needsCors(pathname) && isAllowedOrigin(origin)

  // 1) Préflight → on répond tout de suite avec les bons headers
  if (isPreflight && shouldCors) {
    return new NextResponse(null, {
      status: 204,
      headers: buildCorsHeaders(origin!),
    })
  }

  // 2) Laisser passer la requête vers la route + ajouter CORS en sortie
  const res = NextResponse.next()
  if (shouldCors) {
    const cors = buildCorsHeaders(origin!)
    cors.forEach((v, k) => res.headers.set(k, v))
  }
  return res
}

/**
 * N’applique le middleware que sur les routes API.
 * (Plus sûr, évite d’ajouter des headers CORS aux pages HTML.)
 */
export const config = {
  matcher: ['/api/:path*'],
}
