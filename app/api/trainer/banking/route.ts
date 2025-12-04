// app/api/trainer/banking/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// --- CORS helper ---
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
  res.headers.set('x-mf-banking-cors', '1')

  return res
}

// 👉 pour l’instant : ID formateur fixe juste pour tester le flux
const STATIC_TRAINER_ID = 'demo-trainer-1'

// --- OPTIONS (préflight CORS) ---
export async function OPTIONS(req: Request) {
  const res = new NextResponse(null, { status: 204 })
  return withCors(res, req)
}

// --- GET : charger les infos bancaires ---
export async function GET(req: Request) {
  try {
    const banking = await prisma.trainerBanking.findUnique({
      where: { trainerId: STATIC_TRAINER_ID },
    })

    const ibanLast4 =
      banking?.payoutIban && banking.payoutIban.length >= 4
        ? banking.payoutIban.slice(-4)
        : null

    const body = {
      ok: true,
      auto_payout: banking?.autoPayout ?? false,
      payout_name: banking?.payoutName ?? null,
      payout_country: banking?.payoutCountry ?? null,
      payout_iban: banking?.payoutIban ?? null,
      payout_bic: banking?.payoutBic ?? null,
      iban_last4: ibanLast4,
    }

    return withCors(NextResponse.json(body), req)
  } catch (err) {
    console.error('[MF] GET /api/trainer/banking error', err)
    return withCors(
      NextResponse.json({ ok: false, error: 'SERVER_ERROR' }, { status: 500 }),
      req
    )
  }
}

// --- POST : sauver les infos bancaires ---
export async function POST(req: Request) {
  try {
    const json = await req.json().catch(() => ({}))

    const {
      payout_name,
      payout_country,
      payout_iban,
      payout_bic,
      auto_payout,
    } = json as {
      payout_name?: string
      payout_country?: string
      payout_iban?: string
      payout_bic?: string
      auto_payout?: boolean
    }

    const banking = await prisma.trainerBanking.upsert({
      where: { trainerId: STATIC_TRAINER_ID },
      create: {
        trainerId: STATIC_TRAINER_ID,
        email: null,
        payoutName: payout_name ?? null,
        payoutCountry: payout_country ?? null,
        payoutIban: payout_iban ?? null,
        payoutBic: payout_bic ?? null,
        autoPayout: !!auto_payout,
      },
      update: {
        payoutName: payout_name ?? null,
        payoutCountry: payout_country ?? null,
        payoutIban: payout_iban ?? null,
        payoutBic: payout_bic ?? null,
        autoPayout: !!auto_payout,
      },
    })

    const ibanLast4 =
      banking.payoutIban && banking.payoutIban.length >= 4
        ? banking.payoutIban.slice(-4)
        : null

    const body = {
      ok: true,
      auto_payout: banking.autoPayout,
      payout_name: banking.payoutName,
      payout_country: banking.payoutCountry,
      payout_iban: banking.payoutIban,
      payout_bic: banking.payoutBic,
      iban_last4: ibanLast4,
    }

    return withCors(NextResponse.json(body), req)
  } catch (err) {
    console.error('[MF] POST /api/trainer/banking error', err)
    return withCors(
      NextResponse.json({ ok: false, error: 'SERVER_ERROR' }, { status: 500 }),
      req
    )
  }
}
