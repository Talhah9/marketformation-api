// app/api/trainer/banking/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '../../../../lib/prisma'

// ------------------------
//  CORS helper
// ------------------------
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

  // debug
  res.headers.set('x-mf-banking-cors', '1')

  return res
}

// ------------------------
//  Récupérer l'id formateur
// ------------------------
function getTrainerId(req: Request): string {
  const id =
    req.headers.get('x-mf-trainer-id') ||
    req.headers.get('x-shopify-customer-id') ||
    ''

  if (!id) throw new Error('NO_TRAINER_ID')
  return id
}

// ------------------------
//  OPTIONS (préflight CORS)
// ------------------------
export async function OPTIONS(req: Request) {
  const res = new NextResponse(null, { status: 204 })
  return withCors(res, req)
}

// ------------------------
//  GET = lire infos bancaires
// ------------------------
export async function GET(req: Request) {
  try {
    const trainerId = getTrainerId(req)

    const record = await prisma.trainerBanking.findUnique({
      where: { trainerId },
    })

    const res = NextResponse.json({
      ok: true,
      auto_payout: record?.autoPayout ?? false,
      // on utilise payoutName comme stockage du "iban_last4"
      iban_last4: record?.payoutName ?? null,
    })

    return withCors(res, req)
  } catch (err: any) {
    console.error('[MF] GET /api/trainer/banking error', err)

    if (err?.message === 'NO_TRAINER_ID') {
      const res = NextResponse.json(
        { ok: false, error: 'NO_TRAINER_ID' },
        { status: 401 }
      )
      return withCors(res, req)
    }

    const res = NextResponse.json(
      { ok: false, error: 'SERVER_ERROR' },
      { status: 500 }
    )
    return withCors(res, req)
  }
}

// ------------------------
//  POST = maj infos bancaires
// ------------------------
export async function POST(req: Request) {
  try {
    const trainerId = getTrainerId(req)
    const body = await req.json().catch(() => ({}))

    const {
      auto_payout = false,
      iban_last4 = null, // stocké dans payoutName
      email = null,
    } = body

    const record = await prisma.trainerBanking.upsert({
      where: { trainerId },
      create: {
        trainerId,
        email,
        payoutName: iban_last4,   // 👈 important : champ existant
        autoPayout: !!auto_payout,
      },
      update: {
        autoPayout: !!auto_payout,
        email,
        ...(iban_last4 !== null && { payoutName: iban_last4 }),
      },
    })

    const res = NextResponse.json({
      ok: true,
      auto_payout: record.autoPayout,
      iban_last4: record.payoutName,
    })

    return withCors(res, req)
  } catch (err: any) {
    console.error('[MF] POST /api/trainer/banking error', err)

    if (err?.message === 'NO_TRAINER_ID') {
      const res = NextResponse.json(
        { ok: false, error: 'NO_TRAINER_ID' },
        { status: 401 }
      )
      return withCors(res, req)
    }

    const res = NextResponse.json(
      { ok: false, error: 'SERVER_ERROR' },
      { status: 500 }
    )
    return withCors(res, req)
  }
}
