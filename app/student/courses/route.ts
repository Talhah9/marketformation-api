// app/api/student/courses/route.ts
import { NextResponse } from 'next/server'

type StudentCourseItem = {
  id: string
  title: string
  subtitle?: string
  category_label?: string
  estimated_hours?: number
  level_label?: string
  status?: 'in_progress' | 'completed' | 'not_started'
  image_url?: string | null
  purchase_date?: string | null
  last_access_at?: string | null
  access_url?: string | null
  download_url?: string | null
  product_url?: string | null
  cta_label?: string
}

export async function GET(req: Request) {
  const url = new URL(req.url)

  const email =
    req.headers.get('x-student-email') ||
    url.searchParams.get('email')

  const shopifyCustomerId =
    req.headers.get('x-student-id') ||
    url.searchParams.get('shopifyCustomerId')

  if (!email || !shopifyCustomerId) {
    return NextResponse.json(
      { ok: false, error: 'email_or_customerId_required' },
      { status: 400 }
    )
  }

  // 👉 plus tard : ici on ira chercher les commandes Shopify + produits "course"
  // (via ADMIN_TOKEN) et on construira la vraie liste.
  // Pour l’instant : on renvoie des données de test, juste pour valider le flux.

  const now = new Date()

  const items: StudentCourseItem[] = [
    {
      id: 'demo-1',
      title: 'Devenir formateur IA en 30 jours',
      subtitle: 'Un plan détaillé pour lancer et vendre votre première formation IA.',
      category_label: 'Tech & IA',
      estimated_hours: 4.5,
      level_label: 'Débutant',
      status: 'in_progress',
      image_url: null,
      purchase_date: now.toISOString(),
      last_access_at: now.toISOString(),
      access_url: 'https://marketformation.fr/pages/formation-demo-ia',
      cta_label: 'Accéder à la formation',
    },
    {
      id: 'demo-2',
      title: 'Structurer son offre de formation',
      subtitle: 'Clarifier sa promesse, son pricing et son plan pédagogique.',
      category_label: 'Business & Entrepreneuriat',
      estimated_hours: 2,
      level_label: 'Intermédiaire',
      status: 'not_started',
      image_url: null,
      purchase_date: now.toISOString(),
      last_access_at: null,
      access_url: 'https://marketformation.fr/pages/formation-demo-offre',
      cta_label: 'Accéder à la formation',
    },
  ]

  return NextResponse.json(
    {
      ok: true,
      items,
    },
    { status: 200 }
  )
}
