// app/api/trainer/banking/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTrainerFromRequest } from '@/lib/authTrainer'

function maskIban(iban: string | null | undefined): string | null {
  if (!iban) return null
  const clean = iban.replace(/\s+/g, '')
  if (clean.length <= 8) return clean
  const start = clean.slice(0, 4)
  const end = clean.slice(-4)
  return `${start}••••••••${end}`
}

// --- OPTIONS (préflight CORS) ---
export async function OPTIONS() {
  return new NextResponse(null, { status: 204 })
}

// --- GET: récupérer les infos bancaires du formateur ---
export async function GET(req: NextRequest) {
  const trainer = getTrainerFromRequest(req)
  if (!trainer) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  try {
    const row = await prisma.trainerBanking.findUnique({
      where: { trainerId: trainer.trainerId },
    })

    return NextResponse.json(
      {
        ok: true,
        auto_payout: row?.autoPayout ?? false,
        banking: row
          ? {
              payout_name: row.payoutName,
              payout_country: row.payoutCountry,
              payout_iban_masked: maskIban(row.payoutIban),
              payout_bic: row.payoutBic,
            }
          : null,
      },
      { status: 200 },
    )
  } catch (err) {
    console.error('[MF] GET /api/trainer/banking error', err)
    return NextResponse.json(
      { ok: false, error: 'internal_error' },
      { status: 500 },
    )
  }
}

// --- POST: enregistrer / mettre à jour les infos bancaires ---
export async function POST(req: NextRequest) {
  const trainer = getTrainerFromRequest(req)
  if (!trainer) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  let body: any = {}
  try {
    body = await req.json()
  } catch {
    // pas grave, on gère en dessous
  }

  const {
    payout_name,
    payout_country,
    payout_iban,
    payout_bic,
    auto_payout,
    partial,
  } = body || {}

  const autoFlag = !!auto_payout

  try {
    // Cas “toggle auto payout” uniquement
    if (partial) {
      const rec = await prisma.trainerBanking.upsert({
        where: { trainerId: trainer.trainerId },
        create: {
          trainerId: trainer.trainerId,
          email: trainer.email,
          autoPayout: autoFlag,
        },
        update: {
          autoPayout: autoFlag,
        },
      })

      return NextResponse.json(
        {
          ok: true,
          auto_payout: rec.autoPayout,
        },
        { status: 200 },
      )
    }

    // Cas “enregistrement complet des infos bancaires”
    if (!payout_name || !payout_country || !payout_iban) {
      return NextResponse.json(
        { ok: false, error: 'missing_fields' },
        { status: 400 },
      )
    }

    const rec = await prisma.trainerBanking.upsert({
      where: { trainerId: trainer.trainerId },
      create: {
        trainerId: trainer.trainerId,
        email: trainer.email,
        payoutName: payout_name,
        payoutCountry: payout_country,
        payoutIban: payout_iban,
        payoutBic: payout_bic || null,
        autoPayout: autoFlag,
      },
      update: {
        email: trainer.email ?? undefined,
        payoutName: payout_name,
        payoutCountry: payout_country,
        payoutIban: payout_iban,
        payoutBic: payout_bic || null,
        autoPayout: autoFlag,
      },
    })

    return NextResponse.json(
      {
        ok: true,
        auto_payout: rec.autoPayout,
        banking: {
          payout_name: rec.payoutName,
          payout_country: rec.payoutCountry,
          payout_iban_masked: maskIban(rec.payoutIban),
          payout_bic: rec.payoutBic,
        },
      },
      { status: 200 },
    )
  } catch (err) {
    console.error('[MF] POST /api/trainer/banking error', err)
    return NextResponse.json(
      { ok: false, error: 'internal_error' },
      { status: 500 },
    )
  }
}
