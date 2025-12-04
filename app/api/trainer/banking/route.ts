// app/api/trainer/banking/route.ts
import { NextResponse } from 'next/server'

function withCors(res: NextResponse, req: Request) {
  const origin = req.headers.get('origin') || '*'

  res.headers.set('Access-Control-Allow-Origin', origin)
  res.headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.headers.set(
    'Access-Control-Allow-Headers',
    'Origin, Accept, Content-Type, Authorization, X-Requested-With'
  )
  res.headers.set('Access-Control-Allow-Credentials', 'true')
  res.headers.set('Vary', 'Origin')

  // Petit flag debug pour vérifier que cette route répond bien
  res.headers.set('x-mf-banking-cors', '1')

  return res
}

// 👉 Réponse au préflight CORS
export async function OPTIONS(req: Request) {
  const res = new NextResponse(null, { status: 204 })
  return withCors(res, req)
}

// 👉 Lecture des infos bancaires (stub pour test CORS)
export async function GET(req: Request) {
  // TODO: ici tu mettras ton auth + chargement en DB
  const res = NextResponse.json({
    ok: true,
    auto_payout: false,
    iban_last4: null,
  })
  return withCors(res, req)
}

// 👉 Sauvegarde des infos bancaires / auto_payout (stub pour test CORS)
export async function POST(req: Request) {
  // On lit juste le body pour ne pas crasher
  let payload: any = {}
  try {
    payload = await req.json()
  } catch {
    // ce n'est pas grave pour le test
  }

  // TODO: ici tu feras la maj DB / Stripe, etc.
  const res = NextResponse.json({
    ok: true,
    received: payload,
  })
  return withCors(res, req)
}
