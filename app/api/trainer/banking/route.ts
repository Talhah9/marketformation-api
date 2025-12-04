// app/api/trainer/banking/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// ⚠️ Pour l'instant, on utilise un trainerId fixe pour tester.
// Plus tard, on branchera ça sur le vrai customer Shopify.
const STATIC_TRAINER_ID = 'trainer-demo-1'

function errorJSON(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status })
}

// GET /api/trainer/banking
// ➜ Récupère les infos bancaires stockées pour ce formateur
export async function GET() {
  try {
    const banking = await prisma.trainerBanking.findUnique({
      where: { trainerId: STATIC_TRAINER_ID },
    })

    return NextResponse.json(
      {
        ok: true,
        auto_payout: banking?.autoPayout ?? false,
        iban_last4: banking?.ibanLast4 ?? null,
        banking,
      },
      { status: 200 }
    )
  } catch (err) {
    console.error('[MF] GET /api/trainer/banking error', err)
    return errorJSON('Erreur interne (GET banking)', 500)
  }
}

// POST /api/trainer/banking
// ➜ Sauvegarde les infos venant du formulaire (nom, pays, IBAN, BIC, auto_payout)
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any))

    const {
      payout_name,
      payout_country,
      payout_iban,
      payout_bic,
      auto_payout,
      email,
    } = body as {
      payout_name?: string
      payout_country?: string
      payout_iban?: string
      payout_bic?: string
      auto_payout?: boolean
      email?: string
    }

    // On calcule les 4 derniers chiffres d’IBAN (sans stocker l’IBAN complet si tu veux le retirer plus tard)
    let ibanLast4: string | null = null
    if (typeof payout_iban === 'string' && payout_iban.trim().length >= 4) {
      const digits = payout_iban.replace(/\s+/g, '')
      ibanLast4 = digits.slice(-4)
    }

    const banking = await prisma.trainerBanking.upsert({
      where: { trainerId: STATIC_TRAINER_ID },
      create: {
        trainerId: STATIC_TRAINER_ID,
        email: email ?? null,
        payoutName: payout_name ?? null,
        payoutCountry: payout_country ?? null,
        payoutIban: payout_iban ?? null,
        payoutBic: payout_bic ?? null,
        autoPayout: !!auto_payout,
        ibanLast4,
      },
      update: {
        email: email ?? null,
        payoutName: payout_name ?? null,
        payoutCountry: payout_country ?? null,
        payoutIban: payout_iban ?? null,
        payoutBic: payout_bic ?? null,
        autoPayout: !!auto_payout,
        ibanLast4,
      },
    })

    return NextResponse.json(
      {
        ok: true,
        auto_payout: banking.autoPayout,
        iban_last4: banking.ibanLast4,
        banking,
      },
      { status: 200 }
    )
  } catch (err) {
    console.error('[MF] POST /api/trainer/banking error', err)
    return errorJSON('Erreur interne (POST banking)', 500)
  }
}

// OPTIONS géré par le middleware CORS, donc pas nécessaire ici,
// mais tu peux le laisser si tu veux :
export async function OPTIONS() {
  return new NextResponse(null, { status: 204 })
}
