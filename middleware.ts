// middleware.ts 
import { NextResponse, NextRequest } from 'next/server'

const ENV_ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

const DEFAULT_ORIGINS = [
  'https://tqiccz-96.myshopify.com',
  'https://marketformation.fr',
]

const ALLOWED_ORIGINS = new Set([
  ...(ENV_ORIGINS.length ? ENV_ORIGINS : DEFAULT_ORIGINS),
])

// ✅ j’ai juste ajouté la ligne /^\/api\/payouts\/summary$/,
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
  /^\/api\/payouts\/summary$/,   // <-- AJOUT
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
  h.set('Access-Control-Allow-Credentials', 'true')
  h.set('Vary', 'Origin')
  return h
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (!pathname.startsWith('/api')) {
    return NextResponse.next()
  }

  const origin = req.headers.get('origin')
  const isPreflight =
    req.method === 'OPTIONS' && req.headers.has('access-control-request-method')

  const shouldCors = needsCors(pathname) && isAllowedOrigin(origin)

  if (isPreflight && shouldCors) {
    const headers = buildCorsHeaders(origin!)
    return new NextResponse(null, {
      status: 204,
      headers,
    })
  }

  const res = NextResponse.next()

  if (shouldCors && origin) {
    const cors = buildCorsHeaders(origin)
    cors.forEach((value, key) => {
      res.headers.set(key, value)
    })
  }

  return res
}

export const config = {
  matcher: ['/api/:path*'],
}
