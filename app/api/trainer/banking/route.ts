// app/api/trainer/banking/route.ts
import { NextResponse, NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentTrainer } from '@/lib/authTrainer'

// --- CORS ---
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

export async function OPTIONS(req: Request) {
  return withCors(new NextResponse(null, { status: 204 }), req)
}

// --- GET : chargement des infos bancaires ---
export async function GET(req: NextRequest) {
  try {
    const { trainerId } = await getCurrentTrainer(req)

    const banking = await prisma.trainerBanking.findUnique({
      where: { trainerId }
    })

    const body = {
      ok: true,
      payout_name: banking?.payoutName ?? null,
      payout_country: banking?.payoutCountry ?? null,
      payout_iban: banking?.payoutIban ?? null,
      payout_bic: banking?.payoutBic ?? null,
      auto_payout: banking?.autoPayout ?? false,
    }

    return withCors(NextResponse.json(body), req)

  } catch (err: any) {
    if (err?.message === 'Trainer not authenticated') {
      return withCors(
        NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }),
        req
      )
    }

    console.error('[MF] GET /api/trainer/banking error', err)
    return withCors(
      NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 }),
      req
    )
  }
}

// --- POST : enregistrement des infos bancaires ---
export async function POST(req: NextRequest) {
  try {
    const { trainerId } = await getCurrentTrainer(req)
    const json = await req.json().catch(() => ({}))

    const {
      payout_name,
      payout_country,
      payout_iban,
      payout_bic,
      auto_payout,
    } = json

    const banking = await prisma.trainerBanking.upsert({
      where: { trainerId },
      create: {
        trainerId,
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

    return withCors(
      NextResponse.json({
        ok: true,
        data: {
          payout_name: banking.payoutName,
          payout_country: banking.payoutCountry,
          payout_iban: banking.payoutIban,
          payout_bic: banking.payoutBic,
          auto_payout: banking.autoPayout,
        }
      }),
      req
    )

  } catch (err: any) {
    if (err?.message === 'Trainer not authenticated') {
      return withCors(
        NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }),
        req
      )
    }

    console.error('[MF] POST /api/trainer/banking error', err)
    return withCors(
      NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 }),
      req
    )
  }
}
