// middleware.ts
import { NextResponse, NextRequest } from 'next/server'

/**
 * ORIGINES AUTORISÉES
 * - Priorité à l'env CORS_ORIGINS (séparées par des virgules)
 * - Sinon, fallback sur le domaine Shopify de ta boutique + ton domaine public
 *
 * Exemple d'env CORS_ORIGINS :
 * https://tqiccz-96.myshopify.com,https://marketformation.fr,https://www.marketformation.fr
 */
const ENV_ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

// ⚠️ IMPORTANT : fallback si CORS_ORIGINS est vide
const DEFAULT_ORIGINS = [
  'https://tqiccz-96.myshopify.com',
  'https://marketformation.fr',
  'https://www.marketformation.fr',
]

const ALLOWED_ORIGINS = new Set([
  ...(ENV_ORIGINS.length ? ENV_ORIGINS : DEFAULT_ORIGINS),
])

/**
 * Routes qui nécessitent CORS
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
  h.set(
    'Access-Control-Allow-Headers',
    'Origin, Accept, Content-Type, Authorization, X-Requested-With'
  )
  // 🔥 CRITIQUE : Shopify utilise credentials: "include"
  h.set('Access-Control-Allow-Credentials', 'true')
  h.set('Vary', 'Origin')
  return h
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // On ne s’occupe que de /api/*
  if (!pathname.startsWith('/api')) {
    return NextResponse.next()
  }

  const origin = req.headers.get('origin')
  const isPreflight =
    req.method === 'OPTIONS' && req.headers.has('access-control-request-method')

  const shouldCors = needsCors(pathname) && isAllowedOrigin(origin)

  // 1) Préflight CORS : on répond direct
  if (isPreflight && shouldCors && origin) {
    return new NextResponse(null, {
      status: 204,
      headers: buildCorsHeaders(origin),
    })
  }

  // 2) Requête normale : on laisse passer et on ajoute les headers
  const res = NextResponse.next()

  if (shouldCors && origin) {
    const cors = buildCorsHeaders(origin)
    cors.forEach((v, k) => res.headers.set(k, v))
  }

  return res
}

export const config = {
  matcher: ['/api/:path*'],
}
